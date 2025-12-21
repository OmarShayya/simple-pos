import Sale, {
  ISale,
  SaleStatus,
  PaymentMethod,
  Currency,
} from "../models/sale.model";
import Product, { ProductType } from "../models/product.model";
import Customer from "../models/customer.model";
import GamingSession, {
  SessionPaymentStatus,
  SessionStatus,
} from "../models/gamingsession.model";
import PC, { PCStatus } from "../models/pc.model";
import customerService from "./customer.service";
import productService from "./product.service";
import discountService from "./discount.service";
import Discount, { DiscountTarget } from "../models/discount.model";
import { ApiError } from "../utils/apiError";
import config from "../config/config";
import socketService from "./socket.service";

interface SaleFilters {
  status?: SaleStatus;
  customerId?: string;
  cashierId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

interface SaleItemInput {
  productId: string;
  quantity: number;
  discountId?: string;
}

class SaleService {
  private async generateInvoiceNumber(): Promise<string> {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    const lastSale = await Sale.findOne().sort({ createdAt: -1 });
    let sequence = 1;

    if (lastSale) {
      const lastInvoiceDate = lastSale.invoiceNumber.substring(0, 8);
      const todayDate = `${year}${month}${day}`;

      if (lastInvoiceDate === todayDate) {
        const lastSequence = parseInt(lastSale.invoiceNumber.substring(9), 10);
        sequence = lastSequence + 1;
      }
    }

    return `${year}${month}${day}-${String(sequence).padStart(4, "0")}`;
  }

  private async processSaleItems(items: SaleItemInput[]) {
    const saleItems = await Promise.all(
      items.map(async (item) => {
        const product = await productService.getProductById(item.productId);

        // Only check stock for physical products
        if (product.productType === ProductType.PHYSICAL && product.inventory) {
          if (product.inventory.quantity < item.quantity) {
            throw ApiError.badRequest(
              `Insufficient stock for ${product.name}. Available: ${product.inventory.quantity}`
            );
          }
        }

        const subtotal = {
          usd: product.pricing.usd * item.quantity,
          lbp: product.pricing.lbp * item.quantity,
        };

        let discount = undefined;
        let finalAmount = { ...subtotal };

        // Apply discount if provided
        if (item.discountId) {
          const discountDoc = await Discount.findById(item.discountId);
          if (!discountDoc) {
            throw ApiError.notFound(`Discount ${item.discountId} not found`);
          }

          if (!discountDoc.isActive) {
            throw ApiError.badRequest(
              `Discount ${discountDoc.name} is not active`
            );
          }

          // Validate discount target
          if (discountDoc.target === DiscountTarget.PRODUCT) {
            if (discountDoc.targetId?.toString() !== product._id.toString()) {
              throw ApiError.badRequest(
                `Discount ${discountDoc.name} is not applicable to product ${product.name}`
              );
            }
          } else if (discountDoc.target === DiscountTarget.CATEGORY) {
            if (
              discountDoc.targetId?.toString() !==
              product.category.toString()
            ) {
              throw ApiError.badRequest(
                `Discount ${discountDoc.name} is not applicable to product ${product.name}`
              );
            }
          } else {
            throw ApiError.badRequest(
              `Discount ${discountDoc.name} cannot be applied to individual items`
            );
          }

          const discountAmount = discountService.calculateDiscountAmount(
            subtotal,
            discountDoc.value
          );

          discount = {
            discountId: discountDoc._id,
            discountName: discountDoc.name,
            percentage: discountDoc.value,
            amount: discountAmount,
          };

          finalAmount = {
            usd: subtotal.usd - discountAmount.usd,
            lbp: subtotal.lbp - discountAmount.lbp,
          };
        }

        return {
          product: product._id,
          productId: product._id.toString(),
          productName: product.name,
          productSku: product.sku,
          quantity: item.quantity,
          unitPrice: {
            usd: product.pricing.usd,
            lbp: product.pricing.lbp,
          },
          discount,
          subtotal,
          finalAmount,
        };
      })
    );

    return saleItems;
  }

  async updateSale(
    saleId: string,
    data: {
      customerId?: string;
      items?: SaleItemInput[];
      sessionDiscounts?: Array<{ productSku: string; discountId?: string }>;
      saleDiscountId?: string;
      notes?: string;
    }
  ): Promise<ISale> {
    const sale = await Sale.findById(saleId);
    if (!sale) {
      throw ApiError.notFound("Sale not found");
    }

    if (sale.status !== SaleStatus.PENDING) {
      throw ApiError.badRequest("Can only update pending sales");
    }

    // Handle customer update
    if (data.customerId !== undefined) {
      if (data.customerId) {
        await customerService.getCustomerById(data.customerId);
      }
      sale.customer = data.customerId ? (data.customerId as any) : undefined;
    }

    // Handle items update - including empty array to remove all product items
    if (data.items !== undefined) {
      const sessionItems = sale.items.filter((item) =>
        item.productSku?.startsWith("SESSION-")
      );
      const productItems = sale.items.filter(
        (item) => !item.productSku?.startsWith("SESSION-")
      );

      // Restore stock for old product items
      for (const oldItem of productItems) {
        await productService.updateStock(
          oldItem.product.toString(),
          oldItem.quantity
        );
      }

      // Process new items (can be empty array)
      const saleItems = data.items.length > 0
        ? await this.processSaleItems(data.items)
        : [];

      sale.items = [...sessionItems, ...saleItems] as any;

      // Deduct stock for new items
      for (const item of data.items) {
        await productService.updateStock(item.productId, -item.quantity);
      }
    }

    // Handle session discounts
    if (data.sessionDiscounts && data.sessionDiscounts.length > 0) {
      for (const sessionDiscount of data.sessionDiscounts) {
        const sessionItem = sale.items.find(
          (item) => item.productSku === sessionDiscount.productSku
        );

        if (!sessionItem) {
          throw ApiError.notFound(
            `Session item with SKU ${sessionDiscount.productSku} not found`
          );
        }

        if (!sessionItem.productSku?.startsWith("SESSION-")) {
          throw ApiError.badRequest(
            `Item ${sessionDiscount.productSku} is not a gaming session`
          );
        }

        if (sessionDiscount.discountId) {
          // Apply discount
          const discountDoc = await Discount.findById(sessionDiscount.discountId);
          if (!discountDoc) {
            throw ApiError.notFound(
              `Discount ${sessionDiscount.discountId} not found`
            );
          }

          if (!discountDoc.isActive) {
            throw ApiError.badRequest(
              `Discount ${discountDoc.name} is not active`
            );
          }

          if (discountDoc.target !== DiscountTarget.GAMING_SESSION) {
            throw ApiError.badRequest(
              `Discount ${discountDoc.name} cannot be applied to gaming sessions`
            );
          }

          const discountAmount = discountService.calculateDiscountAmount(
            sessionItem.subtotal,
            discountDoc.value
          );

          sessionItem.discount = {
            discountId: discountDoc._id,
            discountName: discountDoc.name,
            percentage: discountDoc.value,
            amount: discountAmount,
          };

          sessionItem.finalAmount = {
            usd: sessionItem.subtotal.usd - discountAmount.usd,
            lbp: sessionItem.subtotal.lbp - discountAmount.lbp,
          };
        } else {
          // Remove discount
          sessionItem.discount = undefined;
          sessionItem.finalAmount = { ...sessionItem.subtotal };
        }
      }
    }

    // Recalculate totals
    const subtotalBeforeDiscount = sale.items.reduce(
      (acc, item) => ({
        usd: acc.usd + item.subtotal.usd,
        lbp: acc.lbp + item.subtotal.lbp,
      }),
      { usd: 0, lbp: 0 }
    );

    const totalItemDiscounts = sale.items.reduce(
      (acc, item) => ({
        usd: acc.usd + (item.discount?.amount.usd || 0),
        lbp: acc.lbp + (item.discount?.amount.lbp || 0),
      }),
      { usd: 0, lbp: 0 }
    );

    let totals = {
      usd: subtotalBeforeDiscount.usd - totalItemDiscounts.usd,
      lbp: subtotalBeforeDiscount.lbp - totalItemDiscounts.lbp,
    };

    // Handle sale-level discount
    if (data.saleDiscountId !== undefined) {
      if (data.saleDiscountId) {
        const discountDoc = await Discount.findById(data.saleDiscountId);
        if (!discountDoc) {
          throw ApiError.notFound("Sale discount not found");
        }

        if (!discountDoc.isActive) {
          throw ApiError.badRequest(`Discount ${discountDoc.name} is not active`);
        }

        if (discountDoc.target !== DiscountTarget.SALE) {
          throw ApiError.badRequest(
            `Discount ${discountDoc.name} cannot be applied to entire sale`
          );
        }

        const saleDiscountAmount = discountService.calculateDiscountAmount(
          totals,
          discountDoc.value
        );

        sale.saleDiscount = {
          discountId: discountDoc._id,
          discountName: discountDoc.name,
          percentage: discountDoc.value,
          amount: saleDiscountAmount,
        };

        totals = {
          usd: totals.usd - saleDiscountAmount.usd,
          lbp: totals.lbp - saleDiscountAmount.lbp,
        };
      } else {
        // Remove sale discount
        sale.saleDiscount = undefined;
      }
    } else if (sale.saleDiscount) {
      // Recalculate existing sale discount with new totals
      const saleDiscountAmount = discountService.calculateDiscountAmount(
        totals,
        sale.saleDiscount.percentage
      );

      sale.saleDiscount.amount = saleDiscountAmount;

      totals = {
        usd: totals.usd - saleDiscountAmount.usd,
        lbp: totals.lbp - saleDiscountAmount.lbp,
      };
    }

    sale.subtotalBeforeDiscount = subtotalBeforeDiscount;
    sale.totalItemDiscounts = totalItemDiscounts;
    sale.totals = totals;

    if (data.notes !== undefined) {
      sale.notes = data.notes;
    }

    await sale.save();
    return await sale.populate(["customer", "cashier"]);
  }

  async createSale(
    cashierId: string,
    data: {
      customerId?: string;
      items: SaleItemInput[];
      saleDiscountId?: string;
      notes?: string;
    }
  ): Promise<ISale> {
    if (data.customerId) {
      await customerService.getCustomerById(data.customerId);
    }

    // Process items with discounts
    const saleItems = await this.processSaleItems(data.items);

    // Calculate subtotal before any discounts
    const subtotalBeforeDiscount = saleItems.reduce(
      (acc, item) => ({
        usd: acc.usd + item.subtotal.usd,
        lbp: acc.lbp + item.subtotal.lbp,
      }),
      { usd: 0, lbp: 0 }
    );

    // Calculate total item-level discounts
    const totalItemDiscounts = saleItems.reduce(
      (acc, item) => ({
        usd: acc.usd + (item.discount?.amount.usd || 0),
        lbp: acc.lbp + (item.discount?.amount.lbp || 0),
      }),
      { usd: 0, lbp: 0 }
    );

    // Calculate total after item discounts
    let totals = {
      usd: subtotalBeforeDiscount.usd - totalItemDiscounts.usd,
      lbp: subtotalBeforeDiscount.lbp - totalItemDiscounts.lbp,
    };

    // Apply sale-level discount if provided
    let saleDiscount = undefined;
    if (data.saleDiscountId) {
      const discountDoc = await Discount.findById(data.saleDiscountId);
      if (!discountDoc) {
        throw ApiError.notFound("Sale discount not found");
      }

      if (!discountDoc.isActive) {
        throw ApiError.badRequest(`Discount ${discountDoc.name} is not active`);
      }

      if (discountDoc.target !== DiscountTarget.SALE) {
        throw ApiError.badRequest(
          `Discount ${discountDoc.name} cannot be applied to entire sale`
        );
      }

      const saleDiscountAmount = discountService.calculateDiscountAmount(
        totals,
        discountDoc.value
      );

      saleDiscount = {
        discountId: discountDoc._id,
        discountName: discountDoc.name,
        percentage: discountDoc.value,
        amount: saleDiscountAmount,
      };

      totals = {
        usd: totals.usd - saleDiscountAmount.usd,
        lbp: totals.lbp - saleDiscountAmount.lbp,
      };
    }

    const invoiceNumber = await this.generateInvoiceNumber();

    const sale = await Sale.create({
      invoiceNumber,
      customer: data.customerId,
      items: saleItems,
      subtotalBeforeDiscount,
      totalItemDiscounts,
      saleDiscount,
      totals,
      cashier: cashierId,
      notes: data.notes,
      status: SaleStatus.PENDING,
    });

    // Deduct stock
    for (const item of data.items) {
      await productService.updateStock(item.productId, -item.quantity);
    }

    return await sale.populate(["customer", "cashier"]);
  }

  async paySale(
    saleId: string,
    paymentData: {
      paymentMethod: PaymentMethod;
      paymentCurrency: Currency;
      amount: number;
    }
  ): Promise<ISale> {
    let sale = await Sale.findById(saleId);
    if (!sale) {
      throw ApiError.notFound("Sale not found");
    }

    if (sale.status === SaleStatus.PAID) {
      throw ApiError.badRequest("Sale is already paid");
    }

    if (sale.status === SaleStatus.CANCELLED) {
      throw ApiError.badRequest("Cannot pay a cancelled sale");
    }

    const activeSessions = await GamingSession.find({
      sale: sale._id,
      status: SessionStatus.ACTIVE,
    }).populate("pc");

    for (const session of activeSessions) {
      const endTime = new Date();
      const durationMs = endTime.getTime() - session.startTime.getTime();
      const durationMinutes = Math.ceil(durationMs / (1000 * 60));
      const durationHours = durationMinutes / 60;

      const costUsd = session.hourlyRate.usd * durationHours;
      const costLbp = session.hourlyRate.lbp * durationHours;

      session.endTime = endTime;
      session.duration = durationMinutes;
      session.totalCost = {
        usd: Math.round(costUsd * 100) / 100,
        lbp: Math.round(costLbp),
      };
      session.finalAmount = { ...session.totalCost };
      session.status = SessionStatus.COMPLETED;

      await session.save();

      const sessionItem = sale.items.find(
        (item) => item.productSku === `SESSION-${session.sessionNumber}`
      );

      if (sessionItem) {
        sessionItem.unitPrice = session.totalCost;
        sessionItem.subtotal = session.totalCost;
        sessionItem.finalAmount = session.finalAmount;
      }

      const pc = await PC.findById(session.pc);
      if (pc) {
        pc.status = PCStatus.AVAILABLE;
        await pc.save();
        socketService.lockPC(pc.pcNumber);
      }
    }

    if (activeSessions.length > 0) {
      sale.subtotalBeforeDiscount = sale.items.reduce(
        (acc, item) => ({
          usd: acc.usd + item.subtotal.usd,
          lbp: acc.lbp + item.subtotal.lbp,
        }),
        { usd: 0, lbp: 0 }
      );

      sale.totalItemDiscounts = sale.items.reduce(
        (acc, item) => ({
          usd: acc.usd + (item.discount?.amount.usd || 0),
          lbp: acc.lbp + (item.discount?.amount.lbp || 0),
        }),
        { usd: 0, lbp: 0 }
      );

      let totals = {
        usd: sale.subtotalBeforeDiscount.usd - sale.totalItemDiscounts.usd,
        lbp: sale.subtotalBeforeDiscount.lbp - sale.totalItemDiscounts.lbp,
      };

      if (sale.saleDiscount) {
        totals = {
          usd: totals.usd - sale.saleDiscount.amount.usd,
          lbp: totals.lbp - sale.saleDiscount.amount.lbp,
        };
      }

      sale.totals = totals;
      await sale.save();
    }

    const totalInPaymentCurrency =
      paymentData.paymentCurrency === Currency.USD
        ? sale.totals.usd
        : sale.totals.lbp;

    if (paymentData.amount < totalInPaymentCurrency) {
      throw ApiError.badRequest("Insufficient payment amount");
    }

    sale.paymentMethod = paymentData.paymentMethod;
    sale.paymentCurrency = paymentData.paymentCurrency;

    if (paymentData.paymentCurrency === Currency.USD) {
      sale.amountPaid.usd = paymentData.amount;
      sale.amountPaid.lbp = paymentData.amount * config.currency.exchangeRate;
    } else {
      sale.amountPaid.lbp = paymentData.amount;
      sale.amountPaid.usd = paymentData.amount / config.currency.exchangeRate;
    }

    sale.status = SaleStatus.PAID;
    sale.paidAt = new Date();

    await sale.save();

    await GamingSession.updateMany(
      { sale: sale._id },
      { paymentStatus: SessionPaymentStatus.PAID }
    );

    if (sale.customer) {
      await customerService.updatePurchaseStats(
        sale.customer.toString(),
        sale.totals.usd
      );
    }

    return await sale.populate(["customer", "cashier"]);
  }

  async getSaleById(id: string): Promise<ISale> {
    const sale = await Sale.findById(id)
      .populate("customer")
      .populate("cashier", "name email")
      .populate("items.product");

    if (!sale) {
      throw ApiError.notFound("Sale not found");
    }

    return sale;
  }

  async enrichSaleItemsWithSessionData(items: any[]): Promise<any[]> {
    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        // Handle product ID - can be null for session items (PC not in Product collection)
        let productId = null;
        if (item.product) {
          productId =
            typeof item.product === "object" && item.product._id
              ? item.product._id.toString()
              : item.product.toString();
        }

        const enrichedItem = {
          product: productId,
          productId: productId,
          productName: item.productName,
          productSku: item.productSku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          subtotal: item.subtotal,
          finalAmount: item.finalAmount,
        };

        if (item.productSku?.startsWith("SESSION-")) {
          const sessionNumber = item.productSku.replace("SESSION-", "");
          const session = await GamingSession.findOne({ sessionNumber }).populate("pc");

          if (session) {
            const pc = session.pc as any;
            (enrichedItem as any).productName = `Gaming Session - ${pc?.pcNumber || pc?.name || "PC"}`;
            (enrichedItem as any).sessionData = {
              sessionId: session._id.toString(),
              sessionNumber: session.sessionNumber,
              pcNumber: pc?.pcNumber,
              pcName: pc?.name,
              hourlyRate: session.hourlyRate,
              startTime: session.startTime,
              status: session.status,
            };

            if (session.status === SessionStatus.ACTIVE) {
              (enrichedItem as any).isActive = true;
            }
          }
        }

        return enrichedItem;
      })
    );

    return enrichedItems;
  }

  async getCurrentSaleCost(saleId: string): Promise<{
    currentTotals: { usd: number; lbp: number };
    hasActiveSessions: boolean;
    activeSessions: Array<{
      sessionNumber: string;
      currentDuration: number;
      currentCost: { usd: number; lbp: number };
    }>;
  }> {
    const sale = await Sale.findById(saleId);
    if (!sale) {
      throw ApiError.notFound("Sale not found");
    }

    const activeSessions = await GamingSession.find({
      sale: saleId,
      status: SessionStatus.ACTIVE,
    });

    if (activeSessions.length === 0) {
      return {
        currentTotals: sale.totals,
        hasActiveSessions: false,
        activeSessions: [],
      };
    }

    let additionalCost = { usd: 0, lbp: 0 };
    const activeSessionsData = activeSessions.map((session) => {
      const now = new Date();
      const durationMs = now.getTime() - session.startTime.getTime();
      const durationMinutes = Math.ceil(durationMs / (1000 * 60));
      const durationHours = durationMinutes / 60;

      const costUsd = session.hourlyRate.usd * durationHours;
      const costLbp = session.hourlyRate.lbp * durationHours;

      const currentCost = {
        usd: Math.round(costUsd * 100) / 100,
        lbp: Math.round(costLbp),
      };

      additionalCost.usd += currentCost.usd;
      additionalCost.lbp += currentCost.lbp;

      return {
        sessionNumber: session.sessionNumber,
        currentDuration: durationMinutes,
        currentCost,
      };
    });

    const currentTotals = {
      usd: sale.totals.usd + additionalCost.usd,
      lbp: sale.totals.lbp + additionalCost.lbp,
    };

    return {
      currentTotals,
      hasActiveSessions: true,
      activeSessions: activeSessionsData,
    };
  }

  async getSaleByInvoice(invoiceNumber: string): Promise<ISale> {
    const sale = await Sale.findOne({ invoiceNumber })
      .populate("customer")
      .populate("cashier", "name email")
      .populate("items.product");

    if (!sale) {
      throw ApiError.notFound("Sale not found");
    }

    return sale;
  }

  async getAllSales(filters: SaleFilters): Promise<{
    sales: any[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const {
      status,
      customerId,
      cashierId,
      startDate,
      endDate,
      page = 1,
      limit = 20,
    } = filters;

    const query: any = {};

    if (status) {
      query.status = status;
    }

    if (customerId) {
      query.customer = customerId;
    }

    if (cashierId) {
      query.cashier = cashierId;
    }

    if (startDate || endDate) {
      query.createdAt = {};

      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.createdAt.$gte = start;
      }

      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const skip = (page - 1) * limit;

    const [sales, total] = await Promise.all([
      Sale.find(query)
        .populate("customer", "name phone")
        .populate("cashier", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Sale.countDocuments(query),
    ]);

    // Get all sale IDs to find active sessions
    const saleIds = sales.map((s) => s._id);
    const activeSessions = await GamingSession.find({
      sale: { $in: saleIds },
      status: SessionStatus.ACTIVE,
    });

    // Group sessions by sale ID
    const sessionsBySale = new Map<string, typeof activeSessions>();
    for (const session of activeSessions) {
      if (!session.sale) continue;
      const saleId = session.sale.toString();
      if (!sessionsBySale.has(saleId)) {
        sessionsBySale.set(saleId, []);
      }
      sessionsBySale.get(saleId)!.push(session);
    }

    // Enrich sales with real-time costs
    const enrichedSales = sales.map((sale) => {
      const saleObj = sale.toObject();
      const saleSessions = sessionsBySale.get(sale._id.toString()) || [];

      if (saleSessions.length > 0) {
        let additionalCost = { usd: 0, lbp: 0 };

        for (const session of saleSessions) {
          const now = new Date();
          const durationMs = now.getTime() - session.startTime.getTime();
          const durationHours = durationMs / (1000 * 60 * 60);

          additionalCost.usd += session.hourlyRate.usd * durationHours;
          additionalCost.lbp += session.hourlyRate.lbp * durationHours;
        }

        return {
          ...saleObj,
          hasActiveSessions: true,
          currentTotals: {
            usd: Math.round((sale.totals.usd + additionalCost.usd) * 100) / 100,
            lbp: Math.round(sale.totals.lbp + additionalCost.lbp),
          },
        };
      }

      return {
        ...saleObj,
        hasActiveSessions: false,
      };
    });

    return {
      sales: enrichedSales,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async cancelSale(saleId: string): Promise<ISale> {
    const sale = await Sale.findById(saleId);
    if (!sale) {
      throw ApiError.notFound("Sale not found");
    }

    if (sale.status === SaleStatus.PAID) {
      throw ApiError.badRequest("Cannot cancel a paid sale");
    }

    if (sale.status === SaleStatus.CANCELLED) {
      throw ApiError.badRequest("Sale is already cancelled");
    }

    const activeSessions = await GamingSession.find({
      sale: sale._id,
      status: SessionStatus.ACTIVE,
    }).populate("pc");

    for (const session of activeSessions) {
      session.status = SessionStatus.CANCELLED;
      session.endTime = new Date();
      await session.save();

      const pc = await PC.findById(session.pc);
      if (pc) {
        pc.status = PCStatus.AVAILABLE;
        await pc.save();
        socketService.lockPC(pc.pcNumber);
      }
    }

    for (const item of sale.items) {
      if (!item.productSku?.startsWith("SESSION-")) {
        await productService.updateStock(item.product.toString(), item.quantity);
      }
    }

    sale.status = SaleStatus.CANCELLED;
    await sale.save();

    return await sale.populate(["customer", "cashier"]);
  }

  async getTodaySales(): Promise<{
    totalSales: number;
    totalRevenue: { usd: number; lbp: number };
    totalDiscounts: { usd: number; lbp: number };
    pendingSales: number;
    paidSales: number;
    sales: ISale[];
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const sales = await Sale.find({
      createdAt: { $gte: today, $lt: tomorrow },
      status: { $ne: SaleStatus.CANCELLED },
    })
      .populate("customer", "name phone")
      .populate("cashier", "name email")
      .sort({ createdAt: -1 });

    const totalRevenue = sales
      .filter((sale) => sale.status === SaleStatus.PAID)
      .reduce(
        (acc, sale) => ({
          usd: acc.usd + sale.totals.usd,
          lbp: acc.lbp + sale.totals.lbp,
        }),
        { usd: 0, lbp: 0 }
      );

    const totalDiscounts = sales.reduce(
      (acc, sale) => ({
        usd:
          acc.usd +
          (sale.totalItemDiscounts?.usd || 0) +
          (sale.saleDiscount?.amount.usd || 0),
        lbp:
          acc.lbp +
          (sale.totalItemDiscounts?.lbp || 0) +
          (sale.saleDiscount?.amount.lbp || 0),
      }),
      { usd: 0, lbp: 0 }
    );

    return {
      totalSales: sales.length,
      totalRevenue,
      totalDiscounts,
      pendingSales: sales.filter((s) => s.status === SaleStatus.PENDING).length,
      paidSales: sales.filter((s) => s.status === SaleStatus.PAID).length,
      sales,
    };
  }
}

export default new SaleService();
