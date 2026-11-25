import { Types } from "mongoose";
import GamingSession from "../models/gamingsession.model";
import PC, { StationType } from "../models/pc.model";
import Sale, { OrderSource, SaleItemKind } from "../models/sale.model";
import logger from "../utils/logger";
import { gamingLineName } from "../services/gaming/sessionClock";
import { SESSION_SKU_PREFIX } from "../services/orders/orderLines";

/**
 * Idempotent: tags every order line with its kind, turns legacy "SESSION-…" lines into proper gaming
 * lines (session ref, station snapshot, duration; the station id that was wrongly stored as `product`
 * is removed) and marks orders without a source as POS orders.
 */
interface RawItem {
  kind?: string;
  product?: Types.ObjectId;
  productName: string;
  productSku?: string;
  gamingSession?: Types.ObjectId;
  station?: { id: Types.ObjectId; pcNumber: string; name: string; type: string };
  durationMinutes?: number;
  [key: string]: unknown;
}

interface RawSale {
  _id: Types.ObjectId;
  items: RawItem[];
}

const isLegacyGamingLine = (i: RawItem) => i.kind !== SaleItemKind.GAMING && !!i.productSku?.startsWith(SESSION_SKU_PREFIX);

export const migrateLegacyGamingLines = async (): Promise<number> => {
  const sales = await Sale.collection
    .find<RawSale>({
      items: { $elemMatch: { productSku: { $regex: `^${SESSION_SKU_PREFIX}` }, kind: { $ne: SaleItemKind.GAMING } } },
    })
    .project<RawSale>({ items: 1 })
    .toArray();
  if (!sales.length) return 0;

  const numbers = sales.flatMap((s) => s.items.filter(isLegacyGamingLine).map((i) => i.productSku!.slice(SESSION_SKU_PREFIX.length)));
  const sessions = await GamingSession.find({ sessionNumber: { $in: numbers } })
    .select("sessionNumber pc duration")
    .lean();
  const sessionByNumber = new Map(sessions.map((s) => [s.sessionNumber, s]));

  const pcIds = new Set<string>();
  for (const s of sessions) pcIds.add(String(s.pc));
  for (const sale of sales) for (const i of sale.items.filter(isLegacyGamingLine)) if (i.product) pcIds.add(String(i.product));
  const pcs = await PC.find({ _id: { $in: [...pcIds] } }).select("pcNumber name type").lean();
  const pcById = new Map(pcs.map((p) => [String(p._id), p]));

  for (const sale of sales) {
    const items = sale.items.map((item) => {
      if (!isLegacyGamingLine(item)) return item;
      const session = sessionByNumber.get(item.productSku!.slice(SESSION_SKU_PREFIX.length));
      const pc = pcById.get(String(session?.pc ?? item.product));
      const minutes = session?.duration ?? item.durationMinutes ?? 0;
      const { product: _stationIdStoredAsProduct, ...rest } = item;
      return {
        ...rest,
        kind: SaleItemKind.GAMING,
        ...(session ? { gamingSession: session._id } : {}),
        ...(pc
          ? {
              station: { id: pc._id, pcNumber: pc.pcNumber, name: pc.name, type: pc.type ?? StationType.PC },
              productName: gamingLineName(pc.pcNumber, minutes),
            }
          : {}),
        durationMinutes: minutes,
      };
    });
    await Sale.collection.updateOne({ _id: sale._id }, { $set: { items } });
  }
  return sales.length;
};

export const migrateOrderItems = async (): Promise<void> => {
  const gaming = await migrateLegacyGamingLines();
  const products = await Sale.collection.updateMany(
    { items: { $elemMatch: { kind: { $exists: false } } } },
    { $set: { "items.$[line].kind": SaleItemKind.PRODUCT } },
    { arrayFilters: [{ "line.kind": { $exists: false } }] }
  );
  const sources = await Sale.collection.updateMany({ source: { $exists: false } }, { $set: { source: OrderSource.POS } });
  if (gaming || products.modifiedCount || sources.modifiedCount) {
    logger.info(
      `[MIGRATION] Orders: ${gaming} with legacy gaming lines converted, ` +
        `${products.modifiedCount} with product lines tagged, ${sources.modifiedCount} marked as POS orders`
    );
  }
};
