import { FilterQuery, Types } from "mongoose";
import Customer, { CustomerSource, ICustomer, ICustomerAddress } from "../models/customer.model";
import { ApiError } from "../utils/apiError";
import { toCountryCode } from "../utils/country";
import { NormalizedPhone, normalizePhone, phoneSearchFragments, requirePhone } from "../utils/phone";
import logger from "../utils/logger";

interface CustomerFilters {
  search?: string;
  hasBalance?: boolean;
  page?: number;
  limit?: number;
}

export interface AddressInput {
  country?: string;
  city?: string;
  area?: string;
  street?: string;
}

export interface CustomerContact {
  name?: string;
  phone: string;
  phoneCountry?: string;
  email?: string;
}

export interface CreateCustomerInput {
  name: string;
  email?: string;
  phone: string;
  phoneCountry?: string;
  address?: AddressInput;
  notes?: string;
}

export type UpdateCustomerInput = Partial<CreateCustomerInput>;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const placeholderName = (phone: NormalizedPhone) => `Guest ${phone.national.slice(-4)}`;

/** Trims address fields, maps the country to its ISO code, drops empty fields. */
export const normalizeAddress = (input: AddressInput | undefined): ICustomerAddress | undefined => {
  if (!input) return undefined;
  const address: ICustomerAddress = {};
  if (input.country?.trim()) {
    const code = toCountryCode(input.country);
    if (!code) throw ApiError.badRequest("Please choose a country from the list");
    address.country = code;
  }
  for (const key of ["city", "area", "street"] as const) {
    const value = input[key]?.trim();
    if (value) address[key] = value;
  }
  return address;
};

class CustomerService {
  /** Best existing match for a normalized phone: active before inactive, oldest first (dedupes legacy duplicates). */
  async findByPhone(phone: NormalizedPhone): Promise<ICustomer | null> {
    return Customer.findOne({ phone: phone.e164 }).sort({ isActive: -1, createdAt: 1 });
  }

  /**
   * The one place customers are auto-created / linked from a phone number
   * (website orders, reservations, station sessions).
   */
  async findOrCreateByPhone(input: CustomerContact, opts: { source: CustomerSource }): Promise<ICustomer> {
    const phone = requirePhone(input.phone, input.phoneCountry);
    const name = input.name?.trim().slice(0, 100);
    const email = input.email?.trim().toLowerCase() || undefined;

    const existing = await this.findByPhone(phone);
    if (existing) {
      let changed = false;
      if (!existing.isActive) {
        existing.isActive = true;
        changed = true;
      }
      // Only fill a generated name; never overwrite a name someone typed or edited.
      if (name && (existing.hasPlaceholderName || !existing.name?.trim())) {
        existing.name = name;
        existing.hasPlaceholderName = false;
        changed = true;
      }
      if (!existing.email && email) {
        existing.email = email;
        changed = true;
      }
      if (!existing.phoneCountry) {
        existing.phoneCountry = phone.country;
        changed = true;
      }
      if (changed) await existing.save();
      return existing;
    }

    const customer = await Customer.create({
      name: name || placeholderName(phone),
      hasPlaceholderName: !name,
      phone: phone.e164,
      phoneCountry: phone.country,
      email,
      source: opts.source,
    });
    logger.info(`[CUSTOMER] Auto-created ${customer._id} (${phone.e164}) from ${opts.source}`);
    return customer;
  }

  async createCustomer(data: CreateCustomerInput): Promise<ICustomer> {
    const phone = requirePhone(data.phone, data.phoneCountry);
    const email = data.email?.trim().toLowerCase() || undefined;
    const address = normalizeAddress(data.address);

    if (email) {
      const existingEmail = await Customer.findOne({ email, phone: { $ne: phone.e164 }, isActive: true });
      if (existingEmail) throw ApiError.conflict("Customer with this email already exists");
    }

    const existing = await this.findByPhone(phone);
    if (existing?.isActive) throw ApiError.conflict("Customer with this phone number already exists");

    if (existing) {
      // A deleted (deactivated) customer comes back with the new details instead of a duplicate.
      existing.set({
        name: data.name.trim(),
        hasPlaceholderName: false,
        email,
        phoneCountry: phone.country,
        address,
        notes: data.notes,
        isActive: true,
      });
      return existing.save();
    }

    return Customer.create({
      name: data.name.trim(),
      email,
      phone: phone.e164,
      phoneCountry: phone.country,
      address,
      notes: data.notes,
      source: CustomerSource.POS,
    });
  }

  /** Mongo filter matching name / email / phone digits (any format) for a free-text term. */
  buildSearchFilter(term: string): FilterQuery<ICustomer> | null {
    const text = term.trim().slice(0, 100);
    if (!text) return null;
    const pattern = { $regex: escapeRegex(text), $options: "i" };
    const or: FilterQuery<ICustomer>[] = [{ name: pattern }, { email: pattern }];
    for (const fragment of phoneSearchFragments(text)) or.push({ phone: { $regex: escapeRegex(fragment) } });
    return { $or: or };
  }

  /** Ids of customers matching a search term (used by the orders search). */
  async searchIds(term: string, limit = 200): Promise<Types.ObjectId[]> {
    const filter = this.buildSearchFilter(term);
    if (!filter) return [];
    const rows = await Customer.find(filter).select("_id").limit(limit).lean();
    return rows.map((r) => r._id as Types.ObjectId);
  }

  async getAllCustomers(filters: CustomerFilters): Promise<{
    customers: ICustomer[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const { search, hasBalance, page = 1, limit = 20 } = filters;

    const and: FilterQuery<ICustomer>[] = [{ isActive: true }];
    const searchFilter = search ? this.buildSearchFilter(search) : null;
    if (searchFilter) and.push(searchFilter);
    if (hasBalance) and.push({ $or: [{ "balance.usd": { $gt: 0 } }, { "balance.lbp": { $gt: 0 } }] });
    const query: FilterQuery<ICustomer> = { $and: and };

    const skip = (page - 1) * limit;
    const [customers, total] = await Promise.all([
      Customer.find(query).sort({ name: 1 }).skip(skip).limit(limit),
      Customer.countDocuments(query),
    ]);

    return { customers, total, page, totalPages: Math.ceil(total / limit) };
  }

  async getCustomerById(id: string): Promise<ICustomer> {
    if (!Types.ObjectId.isValid(id)) throw ApiError.notFound("Customer not found");
    const customer = await Customer.findById(id);
    if (!customer) {
      throw ApiError.notFound("Customer not found");
    }
    return customer;
  }

  async getCustomerByPhone(phoneInput: string, phoneCountry?: string): Promise<ICustomer> {
    const phone = normalizePhone(phoneInput, phoneCountry);
    const customer = phone
      ? await Customer.findOne({ phone: phone.e164, isActive: true })
      : await Customer.findOne({ phone: phoneInput.trim(), isActive: true });
    if (!customer) {
      throw ApiError.notFound("Customer not found");
    }
    return customer;
  }

  async updateCustomer(id: string, updates: UpdateCustomerInput): Promise<ICustomer> {
    const customer = await this.getCustomerById(id);

    if (updates.phone !== undefined || updates.phoneCountry !== undefined) {
      const phone = requirePhone(updates.phone ?? customer.phone, updates.phoneCountry ?? customer.phoneCountry);
      const clash = await Customer.findOne({ phone: phone.e164, _id: { $ne: id }, isActive: true });
      if (clash) throw ApiError.conflict("Phone number already in use");
      customer.phone = phone.e164;
      customer.phoneCountry = phone.country;
    }

    if (updates.email !== undefined) {
      const email = updates.email.trim().toLowerCase() || undefined;
      if (email) {
        const clash = await Customer.findOne({ email, _id: { $ne: id }, isActive: true });
        if (clash) throw ApiError.conflict("Email already in use");
      }
      customer.email = email;
    }

    if (updates.name !== undefined) {
      customer.name = updates.name.trim();
      customer.hasPlaceholderName = false;
    }
    if (updates.address !== undefined) customer.address = normalizeAddress(updates.address);
    if (updates.notes !== undefined) customer.notes = updates.notes;

    await customer.save();
    return customer;
  }

  async updateBalance(id: string, balance: { usd: number; lbp: number }): Promise<ICustomer> {
    const customer = await Customer.findByIdAndUpdate(id, { balance }, { new: true, runValidators: true });

    if (!customer) {
      throw ApiError.notFound("Customer not found");
    }

    return customer;
  }

  async addToBalance(id: string, amount: { usd?: number; lbp?: number }): Promise<ICustomer> {
    const customer = await this.getCustomerById(id);
    if (amount.usd) customer.balance.usd += amount.usd;
    if (amount.lbp) customer.balance.lbp += amount.lbp;
    await customer.save();
    return customer;
  }

  async deductFromBalance(id: string, amount: { usd?: number; lbp?: number }): Promise<ICustomer> {
    const customer = await this.getCustomerById(id);

    if (amount.usd && customer.balance.usd < amount.usd) {
      throw ApiError.badRequest("Insufficient USD balance");
    }
    if (amount.lbp && customer.balance.lbp < amount.lbp) {
      throw ApiError.badRequest("Insufficient LBP balance");
    }

    if (amount.usd) customer.balance.usd -= amount.usd;
    if (amount.lbp) customer.balance.lbp -= amount.lbp;

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
    return await Customer.find({ isActive: true }).sort({ totalPurchases: -1 }).limit(limit);
  }
}

export default new CustomerService();
