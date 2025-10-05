import Customer, { ICustomer } from "../models/customer.model";
import { ApiError } from "../utils/apiError";

interface CustomerFilters {
  search?: string;
  hasBalance?: boolean;
  page?: number;
  limit?: number;
}

class CustomerService {
  async createCustomer(data: {
    name: string;
    email?: string;
    phone: string;
    address?: {
      street?: string;
      city?: string;
      country?: string;
    };
    notes?: string;
  }): Promise<ICustomer> {
    const existingCustomer = await Customer.findOne({ phone: data.phone });
    if (existingCustomer) {
      throw ApiError.conflict("Customer with this phone number already exists");
    }

    if (data.email) {
      const existingEmail = await Customer.findOne({ email: data.email });
      if (existingEmail) {
        throw ApiError.conflict("Customer with this email already exists");
      }
    }

    const customer = await Customer.create(data);
    return customer;
  }

  async getAllCustomers(filters: CustomerFilters): Promise<{
    customers: ICustomer[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const { search, hasBalance, page = 1, limit = 20 } = filters;

    const query: any = { isActive: true };

    if (search) {
      query.$text = { $search: search };
    }

    if (hasBalance) {
      query.$or = [
        { "balance.usd": { $gt: 0 } },
        { "balance.lbp": { $gt: 0 } },
      ];
    }

    const skip = (page - 1) * limit;

    const [customers, total] = await Promise.all([
      Customer.find(query).sort({ name: 1 }).skip(skip).limit(limit),
      Customer.countDocuments(query),
    ]);

    return {
      customers,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getCustomerById(id: string): Promise<ICustomer> {
    const customer = await Customer.findById(id);
    if (!customer) {
      throw ApiError.notFound("Customer not found");
    }
    return customer;
  }

  async getCustomerByPhone(phone: string): Promise<ICustomer> {
    const customer = await Customer.findOne({ phone, isActive: true });
    if (!customer) {
      throw ApiError.notFound("Customer not found");
    }
    return customer;
  }

  async updateCustomer(
    id: string,
    updates: {
      name?: string;
      email?: string;
      phone?: string;
      address?: {
        street?: string;
        city?: string;
        country?: string;
      };
      notes?: string;
    }
  ): Promise<ICustomer> {
    if (updates.phone) {
      const existingCustomer = await Customer.findOne({
        phone: updates.phone,
        _id: { $ne: id },
      });
      if (existingCustomer) {
        throw ApiError.conflict("Phone number already in use");
      }
    }

    if (updates.email) {
      const existingEmail = await Customer.findOne({
        email: updates.email,
        _id: { $ne: id },
      });
      if (existingEmail) {
        throw ApiError.conflict("Email already in use");
      }
    }

    const customer = await Customer.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    if (!customer) {
      throw ApiError.notFound("Customer not found");
    }

    return customer;
  }

  async updateBalance(
    id: string,
    balance: { usd: number; lbp: number }
  ): Promise<ICustomer> {
    const customer = await Customer.findByIdAndUpdate(
      id,
      { balance },
      { new: true, runValidators: true }
    );

    if (!customer) {
      throw ApiError.notFound("Customer not found");
    }

    return customer;
  }

  async addToBalance(
    id: string,
    amount: { usd?: number; lbp?: number }
  ): Promise<ICustomer> {
    const customer = await Customer.findById(id);
    if (!customer) {
      throw ApiError.notFound("Customer not found");
    }

    if (amount.usd) {
      customer.balance.usd += amount.usd;
    }
    if (amount.lbp) {
      customer.balance.lbp += amount.lbp;
    }

    await customer.save();
    return customer;
  }

  async deductFromBalance(
    id: string,
    amount: { usd?: number; lbp?: number }
  ): Promise<ICustomer> {
    const customer = await Customer.findById(id);
    if (!customer) {
      throw ApiError.notFound("Customer not found");
    }

    if (amount.usd && customer.balance.usd < amount.usd) {
      throw ApiError.badRequest("Insufficient USD balance");
    }
    if (amount.lbp && customer.balance.lbp < amount.lbp) {
      throw ApiError.badRequest("Insufficient LBP balance");
    }

    if (amount.usd) {
      customer.balance.usd -= amount.usd;
    }
    if (amount.lbp) {
      customer.balance.lbp -= amount.lbp;
    }

    await customer.save();
    return customer;
  }

  async updatePurchaseStats(id: string, amount: number): Promise<void> {
    await Customer.findByIdAndUpdate(id, {
      $inc: { totalPurchases: amount },
      lastPurchaseDate: new Date(),
    });
  }

  async deleteCustomer(id: string): Promise<void> {
    const customer = await Customer.findByIdAndUpdate(id, { isActive: false });
    if (!customer) {
      throw ApiError.notFound("Customer not found");
    }
  }

  async getTopCustomers(limit: number = 10): Promise<ICustomer[]> {
    return await Customer.find({ isActive: true })
      .sort({ totalPurchases: -1 })
      .limit(limit);
  }
}

export default new CustomerService();
