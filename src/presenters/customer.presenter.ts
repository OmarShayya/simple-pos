import { ICustomer, ICustomerAddress } from "../models/customer.model";
import { toCountryCode } from "../utils/country";
import { normalizePhone } from "../utils/phone";

/** Address in the current shape; old free-text countries ("Lebanon") are read as ISO codes when possible. */
export const readAddress = (address: ICustomerAddress | undefined | null): ICustomerAddress | undefined => {
  if (!address) return undefined;
  const out: ICustomerAddress = {};
  if (address.country) out.country = toCountryCode(address.country) ?? address.country;
  if (address.city) out.city = address.city;
  if (address.area) out.area = address.area;
  if (address.street) out.street = address.street;
  return Object.keys(out).length ? out : undefined;
};

/** Phone split for a "country dropdown + number" field. */
export const readPhone = (phone: string, phoneCountry?: string) => {
  const parsed = normalizePhone(phone, phoneCountry);
  return {
    phone: parsed?.e164 ?? phone,
    phoneCountry: parsed?.country ?? phoneCountry,
    phoneNational: parsed?.national ?? phone,
  };
};

export const toCustomerSummary = (c: Pick<ICustomer, "_id" | "name" | "phone"> | null | undefined) =>
  c && typeof c === "object" && "name" in c ? { id: c._id.toString(), name: c.name, phone: c.phone } : null;

export const toCustomerDto = (c: ICustomer) => ({
  id: c._id.toString(),
  name: c.name,
  email: c.email,
  ...readPhone(c.phone, c.phoneCountry),
  source: c.source,
  address: readAddress(c.address),
  balance: c.balance,
  totalPurchases: c.totalPurchases,
  lastPurchaseDate: c.lastPurchaseDate,
  notes: c.notes,
  isActive: c.isActive,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});
