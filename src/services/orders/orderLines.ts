import { Types } from "mongoose";
import Product, { IProduct, ProductType } from "../../models/product.model";
import { IGamingSession } from "../../models/gamingsession.model";
import { IPC, StationType } from "../../models/pc.model";
import { IAppliedDiscount, ISale, ISaleItem, SaleItemKind } from "../../models/sale.model";
import { ApiError } from "../../utils/apiError";
import { Money, zeroMoney } from "../../utils/money";
import productService from "../product.service";
import { gamingLineName } from "../gaming/sessionClock";
import { resolveDiscount } from "./discountRules";

/** Gaming lines carry this SKU prefix (kept for older clients that still key lines by SKU). */
export const SESSION_SKU_PREFIX = "SESSION-";

export interface ProductLineInput {
  productId: string;
  quantity: number;
  discountId?: string;
}

export const sessionSku = (sessionNumber: string) => `${SESSION_SKU_PREFIX}${sessionNumber}`;

/** Gaming line (new rows have kind=gaming; un-migrated legacy rows only have the SESSION- SKU). */
export const isGamingLine = (item: Pick<ISaleItem, "kind" | "productSku">): boolean =>
  item.kind === SaleItemKind.GAMING || !!item.productSku?.startsWith(SESSION_SKU_PREFIX);

export const productLines = <T extends Pick<ISaleItem, "kind" | "productSku">>(items: readonly T[]) =>
  items.filter((i) => !isGamingLine(i));

export const gamingLines = <T extends Pick<ISaleItem, "kind" | "productSku">>(items: readonly T[]) =>
  items.filter((i) => isGamingLine(i));

const productLine = (product: IProduct, quantity: number, discount?: IAppliedDiscount): ISaleItem => {
  const unitPrice: Money = { usd: product.pricing.usd, lbp: product.pricing.lbp };
  const subtotal: Money = { usd: unitPrice.usd * quantity, lbp: unitPrice.lbp * quantity };
  return {
    kind: SaleItemKind.PRODUCT,
    product: product._id,
    productName: product.name,
    productSku: product.sku,
    quantity,
    unitPrice,
    discount,
    subtotal,
    // Priced (discount applied) by recalculateOrder
    finalAmount: { ...subtotal },
  };
};

const assertStock = (products: Map<string, IProduct>, inputs: ProductLineInput[]) => {
  const wanted = new Map<string, number>();
  for (const i of inputs) wanted.set(i.productId, (wanted.get(i.productId) ?? 0) + i.quantity);
  for (const [id, quantity] of wanted) {
    const product = products.get(id)!;
    if (product.productType === ProductType.PHYSICAL && product.inventory && product.inventory.quantity < quantity) {
      throw ApiError.badRequest(`Insufficient stock for ${product.name}. Available: ${product.inventory.quantity}`);
    }
  }
};

/** Product lines for a staff order (any product the POS can see; discounts allowed). */
export const buildStaffProductLines = async (inputs: ProductLineInput[]): Promise<ISaleItem[]> => {
  const products = new Map<string, IProduct>();
  for (const input of inputs) {
    if (!products.has(input.productId)) products.set(input.productId, await productService.getProductById(input.productId));
  }
  assertStock(products, inputs);

  const lines: ISaleItem[] = [];
  for (const input of inputs) {
    const product = products.get(input.productId)!;
    const discount = input.discountId
      ? await resolveDiscount(input.discountId, {
          on: "product",
          productId: product._id.toString(),
          categoryId: (product.category as { _id?: Types.ObjectId })?._id?.toString() ?? product.category?.toString(),
          productName: product.name,
        })
      : undefined;
    lines.push(productLine(product, input.quantity, discount));
  }
  return lines;
};

/**
 * Product lines for a website order: prices always come from the database, quantities of the
 * same product are merged, and only active products shown on the menu can be ordered.
 */
export const buildMenuProductLines = async (inputs: Array<{ productId: string; quantity: number }>): Promise<ISaleItem[]> => {
  const merged = new Map<string, number>();
  for (const i of inputs) merged.set(i.productId, (merged.get(i.productId) ?? 0) + i.quantity);

  const ids = [...merged.keys()].filter((id) => Types.ObjectId.isValid(id));
  const found = await Product.find({ _id: { $in: ids }, isActive: true, displayOnMenu: true });
  const products = new Map(found.map((p) => [p._id.toString(), p]));

  const missing = [...merged.keys()].filter((id) => !products.has(id));
  if (missing.length) throw ApiError.badRequest("Some items are no longer available. Please refresh the menu and try again.");

  const mergedInputs = [...merged].map(([productId, quantity]) => ({ productId, quantity }));
  assertStock(products, mergedInputs);
  return mergedInputs.map((i) => productLine(products.get(i.productId)!, i.quantity));
};

/** Takes (direction -1) or returns (+1) stock for the product lines of an order. */
export const moveStock = async (items: readonly ISaleItem[], direction: 1 | -1): Promise<void> => {
  for (const item of productLines(items)) {
    if (!item.product) continue;
    const productId = (item.product as { _id?: Types.ObjectId })._id ?? item.product;
    await productService.updateStock(productId.toString(), direction * item.quantity);
  }
};

// ------------------------------------------------------------------ gaming lines

export const stationSnapshot = (station: IPC) => ({
  id: station._id,
  pcNumber: station.pcNumber,
  name: station.name,
  type: station.type ?? StationType.PC,
});

export const buildGamingLine = (session: IGamingSession, station: IPC): ISaleItem => ({
  kind: SaleItemKind.GAMING,
  productName: gamingLineName(station.pcNumber, 0),
  productSku: sessionSku(session.sessionNumber),
  quantity: 1,
  unitPrice: zeroMoney(),
  subtotal: zeroMoney(),
  finalAmount: zeroMoney(),
  gamingSession: session._id,
  station: stationSnapshot(station),
  durationMinutes: 0,
});

export const findSessionLine = (sale: Pick<ISale, "items">, session: Pick<IGamingSession, "_id" | "sessionNumber">) =>
  sale.items.find(
    (i) => i.gamingSession?.toString() === session._id.toString() || i.productSku === sessionSku(session.sessionNumber)
  );

/** Puts a session's duration and cost on its order line (call recalculateOrder afterwards). */
export const chargeGamingLine = (line: ISaleItem, minutes: number, cost: Money, pcNumber?: string): void => {
  line.kind = SaleItemKind.GAMING;
  line.durationMinutes = minutes;
  line.unitPrice = { usd: cost.usd, lbp: cost.lbp };
  line.subtotal = { usd: cost.usd, lbp: cost.lbp };
  const number = pcNumber ?? line.station?.pcNumber;
  if (number) line.productName = gamingLineName(number, minutes);
};
