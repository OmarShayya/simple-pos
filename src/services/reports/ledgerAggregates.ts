import { Money, roundMoney, roundUsd, zeroMoney, addMoney } from "../../utils/money";
import { locateBucket, PeriodBucket } from "../../utils/period";
import { localHour } from "../../utils/time";
import { LedgerEntry, LedgerLine, LineKind } from "./revenueLedger";

/** Pure aggregations over ledger entries (no database access). */

export interface RevenueTotals {
  revenue: Money;
  gaming: Money;
  products: Money;
  discounts: Money;
  orders: number;
}

const linesOf = (entries: LedgerEntry[], kind?: LineKind): LedgerLine[] =>
  entries.flatMap((e) => (kind ? e.lines.filter((l) => l.kind === kind) : e.lines));

const sum = (lines: { revenue: Money }[]): Money => lines.reduce((acc, l) => addMoney(acc, l.revenue), zeroMoney());

export const revenueTotals = (entries: LedgerEntry[]): RevenueTotals => ({
  revenue: roundMoney(sum(entries)),
  gaming: roundMoney(sum(linesOf(entries, "gaming"))),
  products: roundMoney(sum(linesOf(entries, "product"))),
  discounts: roundMoney(entries.reduce((acc, e) => addMoney(acc, e.discounts), zeroMoney())),
  orders: entries.length,
});

export const average = (total: Money, count: number): Money =>
  count ? roundMoney({ usd: total.usd / count, lbp: total.lbp / count }) : zeroMoney();

export const revenueSeries = (entries: LedgerEntry[], buckets: PeriodBucket[]) => {
  const rows = buckets.map((b) => ({ key: b.key, label: b.label, revenue: 0, gaming: 0, products: 0, orders: 0 }));
  for (const e of entries) {
    const i = locateBucket(buckets, e.at);
    if (i < 0) continue;
    rows[i].orders += 1;
    for (const line of e.lines) {
      rows[i].revenue += line.revenue.usd;
      if (line.kind === "gaming") rows[i].gaming += line.revenue.usd;
      else rows[i].products += line.revenue.usd;
    }
  }
  return rows.map((r) => ({ ...r, revenue: roundUsd(r.revenue), gaming: roundUsd(r.gaming), products: roundUsd(r.products) }));
};

export const byPaymentMethod = (entries: LedgerEntry[]) => {
  const map = new Map<string, { method: string; amount: number; amountLbp: number; count: number }>();
  for (const e of entries) {
    const row = map.get(e.paymentMethod) ?? { method: e.paymentMethod, amount: 0, amountLbp: 0, count: 0 };
    row.amount += e.revenue.usd;
    row.amountLbp += e.revenue.lbp;
    row.count += 1;
    map.set(e.paymentMethod, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, amount: roundUsd(r.amount), amountLbp: Math.round(r.amountLbp) }))
    .sort((a, b) => b.amount - a.amount);
};

export const topProducts = (entries: LedgerEntry[], limit = 10) => {
  const map = new Map<string, { productId: string; name: string; quantity: number; revenue: number }>();
  for (const line of linesOf(entries, "product")) {
    const key = line.productId ?? line.productName;
    const row = map.get(key) ?? { productId: line.productId ?? "", name: line.productName, quantity: 0, revenue: 0 };
    row.quantity += line.quantity;
    row.revenue += line.revenue.usd;
    map.set(key, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, revenue: roundUsd(r.revenue) }))
    .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity)
    .slice(0, limit);
};

export const byCategory = (entries: LedgerEntry[], categoryOf: (productId?: string) => string) => {
  const map = new Map<string, { category: string; revenue: number; quantity: number }>();
  for (const line of linesOf(entries, "product")) {
    const category = categoryOf(line.productId);
    const row = map.get(category) ?? { category, revenue: 0, quantity: 0 };
    row.revenue += line.revenue.usd;
    row.quantity += line.quantity;
    map.set(category, row);
  }
  return [...map.values()].map((r) => ({ ...r, revenue: roundUsd(r.revenue) })).sort((a, b) => b.revenue - a.revenue);
};

/** Orders and revenue by local hour of day (0–23), for the heat strip. */
export const busiestHours = (entries: LedgerEntry[], tz: string) => {
  const rows = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, revenue: 0 }));
  for (const e of entries) {
    const row = rows[localHour(e.at, tz)];
    row.orders += 1;
    row.revenue += e.revenue.usd;
  }
  return rows.map((r) => ({ ...r, revenue: roundUsd(r.revenue) }));
};

export const byStaff = (entries: LedgerEntry[], nameOf: (id: string) => string | undefined) => {
  const map = new Map<string, { id: string; name: string; orders: number; revenue: number }>();
  for (const e of entries) {
    if (!e.staffId) continue;
    const row = map.get(e.staffId) ?? { id: e.staffId, name: nameOf(e.staffId) ?? "Unknown", orders: 0, revenue: 0 };
    row.orders += 1;
    row.revenue += e.revenue.usd;
    map.set(e.staffId, row);
  }
  return [...map.values()].map((r) => ({ ...r, revenue: roundUsd(r.revenue) })).sort((a, b) => b.revenue - a.revenue);
};

/** Gaming revenue per station id. */
export const gamingRevenueByStation = (entries: LedgerEntry[]): Map<string, number> => {
  const map = new Map<string, number>();
  for (const line of linesOf(entries, "gaming")) {
    if (!line.stationId) continue;
    map.set(line.stationId, (map.get(line.stationId) ?? 0) + line.revenue.usd);
  }
  return map;
};
