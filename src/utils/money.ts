/** Amounts are always carried in both currencies: USD (2 decimals) and LBP (whole pounds). */
export interface Money {
  usd: number;
  lbp: number;
}

export const zeroMoney = (): Money => ({ usd: 0, lbp: 0 });

export const roundUsd = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export const roundMoney = (m: Money): Money => ({ usd: roundUsd(m.usd), lbp: Math.round(m.lbp) });

export const addMoney = (a: Money, b: Partial<Money> | undefined | null): Money => ({
  usd: a.usd + (b?.usd ?? 0),
  lbp: a.lbp + (b?.lbp ?? 0),
});

export const subtractMoney = (a: Money, b: Partial<Money> | undefined | null): Money => ({
  usd: a.usd - (b?.usd ?? 0),
  lbp: a.lbp - (b?.lbp ?? 0),
});

export const scaleMoney = (m: Money, factor: number): Money => ({ usd: m.usd * factor, lbp: m.lbp * factor });

export const sumMoney = <T>(items: readonly T[], pick: (item: T) => Partial<Money> | undefined | null): Money =>
  items.reduce<Money>((acc, item) => addMoney(acc, pick(item)), zeroMoney());

/** `percentage`% of an amount, rounded per currency (matches how discounts have always been computed). */
export const percentOf = (m: Money, percentage: number): Money =>
  roundMoney({ usd: (m.usd * percentage) / 100, lbp: (m.lbp * percentage) / 100 });

/** Never let rounding push an amount below zero. */
export const clampMoney = (m: Money): Money => ({ usd: Math.max(0, m.usd), lbp: Math.max(0, m.lbp) });
