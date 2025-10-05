import Sale, {
  ISale,
  SaleStatus,
  PaymentMethod,
  Currency,
} from "../models/sale.model";
import Product from "../models/product.model";
import Customer from "../models/customer.model";
import customerService from "./customer.service";
import productService from "./product.service";
import { ApiError } from "../utils/apiError";
import config from "../config/config";

interface SaleFilters {
  status?: SaleStatus;
  customerId?: string;
  cashierId?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
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

  async createSale(
    cashierId: string,
    data: {
      customerId?: string;
      items: Array<{ productId: string; quantity: number }>;
      notes?: string;
    }
  ): Promise<ISale> {
    if (data.customerId) {
      await customerService.getCustomerById(data.customerId);
    }

    const saleItems = await Promise.all(
      data.items.map(async (item) => {
        const product = await productService.getProductById(item.productId);

        if (product.inventory.quantity < item.quantity) {
          throw ApiError.badRequest(
            `Insufficient stock for ${product.name}. Available: ${product.inventory.quantity}`
          );
        }

        const subtotal = {
          usd: product.pricing.usd * item.quantity,
          lbp: product.pricing.lbp * item.quantity,
        };

        return {
          product: product._id,
          productName: product.name,
          productSku: product.sku,
          quantity: item.quantity,
          unitPrice: {
            usd: product.pricing.usd,
            lbp: product.pricing.lbp,
          },
          subtotal,
        };
      })
    );

    const totals = saleItems.reduce(
      (acc, item) => ({
        usd: acc.usd + item.subtotal.usd,
        lbp: acc.lbp + item.subtotal.lbp,
      }),
      { usd: 0, lbp: 0 }
    );

    const invoiceNumber = await this.generateInvoiceNumber();

    const sale = await Sale.create({
      invoiceNumber,
      customer: data.customerId,
      items: saleItems,
      totals,
      cashier: cashierId,
      notes: data.notes,
      status: SaleStatus.PENDING,
    });

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
    const sale = await Sale.findById(saleId);
    if (!sale) {
      throw ApiError.notFound("Sale not found");
    }

    if (sale.status === SaleStatus.PAID) {
      throw ApiError.badRequest("Sale is already paid");
    }

    if (sale.status === SaleStatus.CANCELLED) {
      throw ApiError.badRequest("Cannot pay a cancelled sale");
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
    sales: ISale[];
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
      if (startDate) query.createdAt.$gte = startDate;
      if (endDate) query.createdAt.$lte = endDate;
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

    return {
      sales,
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

    for (const item of sale.items) {
      await productService.updateStock(item.product.toString(), item.quantity);
    }

    sale.status = SaleStatus.CANCELLED;
    await sale.save();

    return await sale.populate(["customer", "cashier"]);
  }

  async getTodaySales(): Promise<{
    totalSales: number;
    totalRevenue: { usd: number; lbp: number };
    pendingSales: number;
    paidSales: number;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const sales = await Sale.find({
      createdAt: { $gte: today, $lt: tomorrow },
      status: { $ne: SaleStatus.CANCELLED },
    });

    const totalRevenue = sales
      .filter((sale) => sale.status === SaleStatus.PAID)
      .reduce(
        (acc, sale) => ({
          usd: acc.usd + sale.totals.usd,
          lbp: acc.lbp + sale.totals.lbp,
        }),
        { usd: 0, lbp: 0 }
      );

    return {
      totalSales: sales.length,
      totalRevenue,
      pendingSales: sales.filter((s) => s.status === SaleStatus.PENDING).length,
      paidSales: sales.filter((s) => s.status === SaleStatus.PAID).length,
    };
  }
}

export default new SaleService();
