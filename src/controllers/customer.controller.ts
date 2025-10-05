import { Response, NextFunction } from "express";
import { CustomRequest } from "../types";
import customerService from "../services/customer.service";
import { ApiResponseUtil } from "../utils/apiResponse";
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  UpdateBalanceDto,
} from "../dtos/customer.dto";

class CustomerController {
  async createCustomer(req: CustomRequest, res: Response, next: NextFunction) {
    const data: CreateCustomerDto = req.body;
    const customer = await customerService.createCustomer(data);

    return ApiResponseUtil.created(
      res,
      {
        id: customer._id.toString(),
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        balance: customer.balance,
        notes: customer.notes,
        createdAt: customer.createdAt,
      },
      "Customer created successfully"
    );
  }

  async getAllCustomers(req: CustomRequest, res: Response, next: NextFunction) {
    const filters = {
      search: req.query.search as string,
      hasBalance: req.query.hasBalance === "true",
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
    };

    const result = await customerService.getAllCustomers(filters);

    return ApiResponseUtil.paginated(
      res,
      result.customers.map((customer) => ({
        id: customer._id.toString(),
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        balance: customer.balance,
        totalPurchases: customer.totalPurchases,
        lastPurchaseDate: customer.lastPurchaseDate,
        createdAt: customer.createdAt,
      })),
      result.page,
      filters.limit,
      result.total,
      "Customers retrieved successfully"
    );
  }

  async getCustomerById(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const customer = await customerService.getCustomerById(id);

    return ApiResponseUtil.success(
      res,
      {
        id: customer._id.toString(),
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        balance: customer.balance,
        totalPurchases: customer.totalPurchases,
        lastPurchaseDate: customer.lastPurchaseDate,
        notes: customer.notes,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
      },
      "Customer retrieved successfully"
    );
  }

  async getCustomerByPhone(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const { phone } = req.params;
    const customer = await customerService.getCustomerByPhone(phone);

    return ApiResponseUtil.success(
      res,
      {
        id: customer._id.toString(),
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        balance: customer.balance,
        totalPurchases: customer.totalPurchases,
        lastPurchaseDate: customer.lastPurchaseDate,
      },
      "Customer retrieved successfully"
    );
  }

  async updateCustomer(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const updates: UpdateCustomerDto = req.body;
    const customer = await customerService.updateCustomer(id, updates);

    return ApiResponseUtil.success(
      res,
      {
        id: customer._id.toString(),
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        notes: customer.notes,
        updatedAt: customer.updatedAt,
      },
      "Customer updated successfully"
    );
  }

  async updateBalance(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const balance: UpdateBalanceDto = req.body;
    const customer = await customerService.updateBalance(id, balance);

    return ApiResponseUtil.success(
      res,
      {
        id: customer._id.toString(),
        name: customer.name,
        balance: customer.balance,
      },
      "Customer balance updated successfully"
    );
  }

  async deleteCustomer(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    await customerService.deleteCustomer(id);
    return ApiResponseUtil.noContent(res);
  }

  async getTopCustomers(req: CustomRequest, res: Response, next: NextFunction) {
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const customers = await customerService.getTopCustomers(limit);

    return ApiResponseUtil.success(
      res,
      customers.map((customer) => ({
        id: customer._id.toString(),
        name: customer.name,
        phone: customer.phone,
        totalPurchases: customer.totalPurchases,
        lastPurchaseDate: customer.lastPurchaseDate,
      })),
      "Top customers retrieved successfully"
    );
  }
}

export default new CustomerController();
