import { Response, NextFunction } from "express";
import { CustomRequest } from "../types";
import saleService from "../services/sale.service";
import { ApiResponseUtil } from "../utils/apiResponse";
import { CreateSaleDto, PaySaleDto, UpdateSaleDto } from "../dtos/sale.dto";
import { SaleStatus } from "../models/sale.model";

class SaleController {
  async createSale(req: CustomRequest, res: Response, next: NextFunction) {
    const data: CreateSaleDto = req.body;
    const cashierId = req.user!.id;

    const sale = await saleService.createSale(cashierId, data);

    return ApiResponseUtil.created(
      res,
      {
        id: sale._id.toString(),
        invoiceNumber: sale.invoiceNumber,
        customer: sale.customer
          ? {
              id: (sale.customer as any)._id.toString(),
              name: (sale.customer as any).name,
              phone: (sale.customer as any).phone,
            }
          : null,
        items: sale.items.map((item) => ({
          product:
            typeof item.product === "object"
              ? (item.product as any)._id.toString()
              : item.product.toString(),
          productId:
            typeof item.product === "object"
              ? (item.product as any)._id.toString()
              : item.product.toString(),
          productName: item.productName,
          productSku: item.productSku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          subtotal: item.subtotal,
          finalAmount: item.finalAmount,
        })),
        subtotalBeforeDiscount: sale.subtotalBeforeDiscount,
        totalItemDiscounts: sale.totalItemDiscounts,
        saleDiscount: sale.saleDiscount,
        totals: sale.totals,
        status: sale.status,
        createdAt: sale.createdAt,
      },
      "Sale created successfully"
    );
  }

  async paySale(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const paymentData: PaySaleDto = req.body;

    const sale = await saleService.paySale(id, paymentData);

    return ApiResponseUtil.success(
      res,
      {
        id: sale._id.toString(),
        invoiceNumber: sale.invoiceNumber,
        status: sale.status,
        paymentMethod: sale.paymentMethod,
        paymentCurrency: sale.paymentCurrency,
        amountPaid: sale.amountPaid,
        paidAt: sale.paidAt,
      },
      "Payment processed successfully"
    );
  }

  async getSaleById(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const sale = await saleService.getSaleById(id);
    const currentCostData = await saleService.getCurrentSaleCost(id);
    const enrichedItems = await saleService.enrichSaleItemsWithSessionData(
      sale.items
    );

    return ApiResponseUtil.success(
      res,
      {
        id: sale._id.toString(),
        invoiceNumber: sale.invoiceNumber,
        customer: sale.customer
          ? {
              id: (sale.customer as any)._id.toString(),
              name: (sale.customer as any).name,
              phone: (sale.customer as any).phone,
            }
          : null,
        items: enrichedItems,
        subtotalBeforeDiscount: sale.subtotalBeforeDiscount,
        totalItemDiscounts: sale.totalItemDiscounts,
        saleDiscount: sale.saleDiscount,
        totals: sale.totals,
        currentTotals: currentCostData.currentTotals,
        hasActiveSessions: currentCostData.hasActiveSessions,
        activeSessions: currentCostData.activeSessions,
        paymentMethod: sale.paymentMethod,
        paymentCurrency: sale.paymentCurrency,
        amountPaid: sale.amountPaid,
        status: sale.status,
        cashier: {
          name: (sale.cashier as any).name,
          email: (sale.cashier as any).email,
        },
        notes: sale.notes,
        paidAt: sale.paidAt,
        createdAt: sale.createdAt,
      },
      "Sale retrieved successfully"
    );
  }

  async getSaleByInvoice(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const { invoiceNumber } = req.params;
    const sale = await saleService.getSaleByInvoice(invoiceNumber);

    return ApiResponseUtil.success(
      res,
      {
        id: sale._id.toString(),
        invoiceNumber: sale.invoiceNumber,
        customer: sale.customer
          ? {
              id: (sale.customer as any)._id.toString(),
              name: (sale.customer as any).name,
              phone: (sale.customer as any).phone,
            }
          : null,
        items: sale.items.map((item) => ({
          product:
            typeof item.product === "object"
              ? (item.product as any)._id.toString()
              : item.product.toString(),
          productId:
            typeof item.product === "object"
              ? (item.product as any)._id.toString()
              : item.product.toString(),
          productName: item.productName,
          productSku: item.productSku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          subtotal: item.subtotal,
          finalAmount: item.finalAmount,
        })),
        subtotalBeforeDiscount: sale.subtotalBeforeDiscount,
        totalItemDiscounts: sale.totalItemDiscounts,
        saleDiscount: sale.saleDiscount,
        totals: sale.totals,
        paymentMethod: sale.paymentMethod,
        status: sale.status,
        paidAt: sale.paidAt,
        createdAt: sale.createdAt,
      },
      "Sale retrieved successfully"
    );
  }

  async updateSale(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const data: UpdateSaleDto = req.body;

    const sale = await saleService.updateSale(id, data);

    return ApiResponseUtil.success(
      res,
      {
        id: sale._id.toString(),
        invoiceNumber: sale.invoiceNumber,
        customer: sale.customer
          ? {
              id: (sale.customer as any)._id.toString(),
              name: (sale.customer as any).name,
              phone: (sale.customer as any).phone,
            }
          : null,
        items: sale.items.map((item) => ({
          product:
            typeof item.product === "object"
              ? (item.product as any)._id.toString()
              : item.product.toString(),
          productId:
            typeof item.product === "object"
              ? (item.product as any)._id.toString()
              : item.product.toString(),
          productName: item.productName,
          productSku: item.productSku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          subtotal: item.subtotal,
          finalAmount: item.finalAmount,
        })),
        subtotalBeforeDiscount: sale.subtotalBeforeDiscount,
        totalItemDiscounts: sale.totalItemDiscounts,
        saleDiscount: sale.saleDiscount,
        totals: sale.totals,
        status: sale.status,
        createdAt: sale.createdAt,
      },
      "Sale updated successfully"
    );
  }

  async getAllSales(req: CustomRequest, res: Response, next: NextFunction) {
    const filters = {
      status: req.query.status as SaleStatus,
      customerId: req.query.customerId as string,
      cashierId: req.query.cashierId as string,
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
    };

    const result = await saleService.getAllSales(filters);

    return ApiResponseUtil.paginated(
      res,
      result.sales.map((sale) => ({
        id: sale._id.toString(),
        invoiceNumber: sale.invoiceNumber,
        customer: sale.customer
          ? {
              name: (sale.customer as any).name,
              phone: (sale.customer as any).phone,
            }
          : null,
        subtotalBeforeDiscount: sale.subtotalBeforeDiscount,
        totalItemDiscounts: sale.totalItemDiscounts,
        saleDiscount: sale.saleDiscount,
        totals: sale.totals,
        paymentMethod: sale.paymentMethod,
        paymentCurrency: sale.paymentCurrency,
        status: sale.status,
        cashier: (sale.cashier as any).name,
        createdAt: sale.createdAt,
      })),
      result.page,
      filters.limit,
      result.total,
      "Sales retrieved successfully"
    );
  }

  async cancelSale(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    await saleService.cancelSale(id);

    return ApiResponseUtil.success(res, null, "Sale cancelled successfully");
  }

  async getTodaySales(req: CustomRequest, res: Response, next: NextFunction) {
    const result = await saleService.getTodaySales();

    return ApiResponseUtil.success(
      res,
      {
        totalSales: result.totalSales,
        totalRevenue: result.totalRevenue,
        totalDiscounts: result.totalDiscounts,
        pendingSales: result.pendingSales,
        paidSales: result.paidSales,
        sales: result.sales.map((sale) => ({
          id: sale._id.toString(),
          invoiceNumber: sale.invoiceNumber,
          customer: sale.customer
            ? {
                name: (sale.customer as any).name,
                phone: (sale.customer as any).phone,
              }
            : null,
          subtotalBeforeDiscount: sale.subtotalBeforeDiscount,
          totalItemDiscounts: sale.totalItemDiscounts,
          saleDiscount: sale.saleDiscount,
          totals: sale.totals,
          paymentMethod: sale.paymentMethod,
          paymentCurrency: sale.paymentCurrency,
          status: sale.status,
          cashier: (sale.cashier as any).name,
          paidAt: sale.paidAt,
          createdAt: sale.createdAt,
        })),
      },
      "Today sales stats retrieved successfully"
    );
  }
}

export default new SaleController();
