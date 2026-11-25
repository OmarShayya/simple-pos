import { Response, NextFunction } from "express";
import { CustomRequest } from "../types";
import customerService from "../services/customer.service";
import { ApiResponseUtil } from "../utils/apiResponse";
import { CreateCustomerDto, UpdateCustomerDto, UpdateBalanceDto } from "../dtos/customer.dto";
import { toCustomerDto } from "../presenters/customer.presenter";

const positiveInt = (value: unknown, fallback: number, max = 100) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
};

class CustomerController {
  async createCustomer(req: CustomRequest, res: Response, _next: NextFunction) {
    const data: CreateCustomerDto = req.body;
    const customer = await customerService.createCustomer(data);
    return ApiResponseUtil.created(res, toCustomerDto(customer), "Customer created successfully");
  }

  async getAllCustomers(req: CustomRequest, res: Response, _next: NextFunction) {
    const filters = {
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      hasBalance: req.query.hasBalance === "true",
      page: positiveInt(req.query.page, 1, 100000),
      limit: positiveInt(req.query.limit, 20),
    };
    const result = await customerService.getAllCustomers(filters);

    return ApiResponseUtil.paginated(
      res,
      result.customers.map(toCustomerDto),
      result.page,
      filters.limit,
      result.total,
      "Customers retrieved successfully"
    );
  }

  async getCustomerById(req: CustomRequest, res: Response, _next: NextFunction) {
    const customer = await customerService.getCustomerById(req.params.id);
    return ApiResponseUtil.success(res, toCustomerDto(customer), "Customer retrieved successfully");
  }

  async getCustomerByPhone(req: CustomRequest, res: Response, _next: NextFunction) {
    const country = typeof req.query.country === "string" ? req.query.country : undefined;
    const customer = await customerService.getCustomerByPhone(req.params.phone, country);
    return ApiResponseUtil.success(res, toCustomerDto(customer), "Customer retrieved successfully");
  }

  async updateCustomer(req: CustomRequest, res: Response, _next: NextFunction) {
    const updates: UpdateCustomerDto = req.body;
    const customer = await customerService.updateCustomer(req.params.id, updates);
    return ApiResponseUtil.success(res, toCustomerDto(customer), "Customer updated successfully");
  }

  async updateBalance(req: CustomRequest, res: Response, _next: NextFunction) {
    const balance: UpdateBalanceDto = req.body;
    const customer = await customerService.updateBalance(req.params.id, balance);
    return ApiResponseUtil.success(
      res,
      { id: customer._id.toString(), name: customer.name, balance: customer.balance },
      "Customer balance updated successfully"
    );
  }

  async deleteCustomer(req: CustomRequest, res: Response, _next: NextFunction) {
    await customerService.deleteCustomer(req.params.id);
    return ApiResponseUtil.noContent(res);
  }

  async getTopCustomers(req: CustomRequest, res: Response, _next: NextFunction) {
    const customers = await customerService.getTopCustomers(positiveInt(req.query.limit, 10));
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
