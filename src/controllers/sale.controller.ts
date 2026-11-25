import type { OrderTypeFilter } from "../services/orders/orderQuery";
import { Response, NextFunction } from "express";
import { CustomRequest } from "../types";
import saleService from "../services/sale.service";
import { ApiResponseUtil } from "../utils/apiResponse";
import { ApiError } from "../utils/apiError";
import { CreateSaleDto, ListOrdersQueryDto, PaySaleDto, PublicOrderDto, UpdateSaleDto } from "../dtos/sale.dto";
import { ISale, SaleStatus } from "../models/sale.model";
import { toOrderDetail, toOrderRow } from "../presenters/order.presenter";
import { placeWebsiteOrder } from "../services/orders/websiteOrders";

/** Short confirmation shape returned by write endpoints (the client refetches the detail). */
const toWriteResult = (sale: ISale) => ({
  id: sale._id.toString(),
  invoiceNumber: sale.invoiceNumber,
  source: sale.source,
  status: sale.status,
  customer: sale.customer?.name
    ? { id: sale.customer._id.toString(), name: sale.customer.name, phone: sale.customer.phone }
    : null,
  customerName: sale.customerName ?? null,
  items: sale.items.map((item) => ({
    kind: item.kind,
    product: item.product ? (item.product._id ?? item.product).toString() : null,
    productId: item.product ? (item.product._id ?? item.product).toString() : null,
    productName: item.productName,
    productSku: item.productSku,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discount: item.discount,
    subtotal: item.subtotal,
    finalAmount: item.finalAmount,
    gamingSession: item.gamingSession?.toString(),
    station: item.station,
    durationMinutes: item.durationMinutes,
  })),
  subtotalBeforeDiscount: sale.subtotalBeforeDiscount,
  totalItemDiscounts: sale.totalItemDiscounts,
  saleDiscount: sale.saleDiscount,
  totals: sale.totals,
  createdAt: sale.createdAt,
});

class SaleController {
  async createSale(req: CustomRequest, res: Response, _next: NextFunction) {
    const data: CreateSaleDto = req.body;
    const sale = await saleService.createSale(req.user!.id, data);
    return ApiResponseUtil.created(res, toWriteResult(sale), "Sale created successfully");
  }

  /** Website menu order (public). */
  async createPublicOrder(req: CustomRequest, res: Response, _next: NextFunction) {
    const body: PublicOrderDto = req.body;
    if (body.website) {
      // Honeypot tripped: pretend nothing happened
      throw ApiError.badRequest("Could not place the order");
    }
    const order = await placeWebsiteOrder(body);
    return ApiResponseUtil.created(res, order, "Your order has been sent");
  }

  async paySale(req: CustomRequest, res: Response, _next: NextFunction) {
    const paymentData: PaySaleDto = req.body;
    const sale = await saleService.paySale(req.params.id, paymentData, req.user!.id);

    return ApiResponseUtil.success(
      res,
      {
        id: sale._id.toString(),
        invoiceNumber: sale.invoiceNumber,
        status: sale.status,
        totals: sale.totals,
        paymentMethod: sale.paymentMethod,
        paymentCurrency: sale.paymentCurrency,
        amountPaid: sale.amountPaid,
        paidAt: sale.paidAt,
      },
      "Payment processed successfully"
    );
  }

  async getSaleById(req: CustomRequest, res: Response, _next: NextFunction) {
    const { order, sessions } = await saleService.getOrderDetail(req.params.id);
    return ApiResponseUtil.success(res, toOrderDetail(order, sessions), "Sale retrieved successfully");
  }

  async getSaleByInvoice(req: CustomRequest, res: Response, _next: NextFunction) {
    const { order, sessions } = await saleService.getOrderDetailByInvoice(req.params.invoiceNumber);
    return ApiResponseUtil.success(res, toOrderDetail(order, sessions), "Sale retrieved successfully");
  }

  async updateSale(req: CustomRequest, res: Response, _next: NextFunction) {
    const data: UpdateSaleDto = req.body;
    const sale = await saleService.updateSale(req.params.id, data);
    return ApiResponseUtil.success(res, toWriteResult(sale), "Sale updated successfully");
  }

  async getAllSales(req: CustomRequest, res: Response, _next: NextFunction) {
    const q = res.locals.query as ListOrdersQueryDto;
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const result = await saleService.listOrders(
      {
        status: q.status ? (q.status.split(",") as SaleStatus[]) : undefined,
        source: q.source,
        types: q.type ? (q.type.split(",") as OrderTypeFilter[]) : undefined,
        search: q.search,
        from: q.from ?? q.startDate,
        to: q.to ?? q.endDate,
        customerId: q.customerId,
        cashierId: q.cashierId,
      },
      page,
      limit
    );

    return ApiResponseUtil.paginated(
      res,
      result.orders.map(toOrderRow),
      result.page,
      limit,
      result.total,
      "Sales retrieved successfully"
    );
  }

  async getCounts(req: CustomRequest, res: Response, _next: NextFunction) {
    const counts = await saleService.getCounts();
    return ApiResponseUtil.success(res, counts, "Order counts retrieved");
  }

  async cancelSale(req: CustomRequest, res: Response, _next: NextFunction) {
    await saleService.cancelSale(req.params.id, req.user!.id);
    return ApiResponseUtil.success(res, null, "Sale cancelled successfully");
  }

  async getTodaySales(req: CustomRequest, res: Response, _next: NextFunction) {
    const result = await saleService.getTodaySales();
    const { orders, ...stats } = result;
    return ApiResponseUtil.success(
      res,
      { ...stats, sales: orders.map(toOrderRow) },
      "Today sales stats retrieved successfully"
    );
  }
}

export default new SaleController();
