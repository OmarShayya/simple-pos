import { AnyBulkWriteOperation } from "mongoose";
import Customer, { ICustomer } from "../models/customer.model";
import Reservation, { IReservation } from "../models/reservation.model";
import { toCountryCode } from "../utils/country";
import logger from "../utils/logger";
import { DEFAULT_PHONE_COUNTRY, normalizePhone, phoneKeyOf } from "../utils/phone";

/**
 * Idempotent: stores every phone as E.164 + phoneCountry (numbers without a country code are Lebanese)
 * and maps free-text address countries to ISO codes. Values that can't be parsed are left untouched
 * and logged — nothing is ever dropped.
 */
const E164 = /^\+\d{6,15}$/;
const BATCH = 500;

const flush = async <T>(model: { bulkWrite: (ops: AnyBulkWriteOperation<T>[]) => Promise<unknown> }, ops: AnyBulkWriteOperation<T>[]) => {
  if (ops.length) await model.bulkWrite(ops.splice(0, ops.length));
};

export const migrateCustomerPhones = async (): Promise<{ updated: number; unparsed: string[] }> => {
  const unparsed: string[] = [];
  const ops: AnyBulkWriteOperation<ICustomer>[] = [];
  let updated = 0;

  const cursor = Customer.find({
    $or: [
      { phone: { $not: E164 } },
      { phoneCountry: { $exists: false } },
      { "address.country": { $exists: true, $not: /^[A-Z]{2}$/ } },
    ],
  })
    .select("phone phoneCountry address")
    .lean<ICustomer[]>()
    .cursor();

  for await (const c of cursor) {
    const set: Record<string, string> = {};
    const phone = normalizePhone(c.phone, c.phoneCountry || DEFAULT_PHONE_COUNTRY);
    if (phone) {
      if (phone.e164 !== c.phone) set.phone = phone.e164;
      if (phone.country !== c.phoneCountry) set.phoneCountry = phone.country;
    } else if (!E164.test(c.phone ?? "")) {
      unparsed.push(`customer ${c._id}: "${c.phone}"`);
    }
    const country = c.address?.country;
    if (country && !/^[A-Z]{2}$/.test(country)) {
      const code = toCountryCode(country);
      if (code) set["address.country"] = code;
    }
    if (Object.keys(set).length) {
      ops.push({ updateOne: { filter: { _id: c._id }, update: { $set: set } } });
      updated++;
    }
    if (ops.length >= BATCH) await flush(Customer, ops);
  }
  await flush(Customer, ops);
  return { updated, unparsed };
};

export const migrateReservationPhones = async (): Promise<{ updated: number; unparsed: string[] }> => {
  const unparsed: string[] = [];
  const ops: AnyBulkWriteOperation<IReservation>[] = [];
  let updated = 0;

  const cursor = Reservation.find({ $or: [{ customerPhone: { $not: E164 } }, { phoneCountry: { $exists: false } }] })
    .select("customerPhone phoneCountry phoneKey code")
    .lean<IReservation[]>()
    .cursor();

  for await (const r of cursor) {
    const phone = normalizePhone(r.customerPhone, r.phoneCountry || DEFAULT_PHONE_COUNTRY);
    if (!phone) {
      if (!E164.test(r.customerPhone ?? "")) unparsed.push(`reservation ${r.code}: "${r.customerPhone}"`);
      continue;
    }
    ops.push({
      updateOne: {
        filter: { _id: r._id },
        update: { $set: { customerPhone: phone.e164, phoneCountry: phone.country, phoneKey: phoneKeyOf(phone.e164) } },
      },
    });
    updated++;
    if (ops.length >= BATCH) await flush(Reservation, ops);
  }
  await flush(Reservation, ops);
  return { updated, unparsed };
};

export const migratePhones = async (): Promise<void> => {
  const customers = await migrateCustomerPhones();
  const reservations = await migrateReservationPhones();
  if (customers.updated || reservations.updated) {
    logger.info(`[MIGRATION] Phones normalized: ${customers.updated} customer(s), ${reservations.updated} reservation(s)`);
  }
  const unparsed = [...customers.unparsed, ...reservations.unparsed];
  if (unparsed.length) {
    logger.warn(
      `[MIGRATION] ${unparsed.length} phone number(s) could not be parsed and were left as-is: ` +
        unparsed.slice(0, 20).join("; ") +
        (unparsed.length > 20 ? " …" : "")
    );
  }
};
