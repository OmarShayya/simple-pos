/**
 * Country helpers for addresses. Countries are stored as ISO-3166 alpha-2 codes ("LB");
 * older rows hold free text ("Lebanon"), which is mapped to a code when possible.
 */

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
let codes: Set<string> | null = null;
let byName: Map<string, string> | null = null;

const buildTables = () => {
  codes = new Set();
  byName = new Map();
  const names = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
  for (const a of LETTERS) {
    for (const b of LETTERS) {
      const code = a + b;
      let name: string | undefined;
      try {
        name = names.of(code);
      } catch {
        name = undefined;
      }
      // Skip unassigned codes and macro-regions like "EU"/"UN"
      if (!name || name === code || ["EU", "EZ", "UN", "QO", "XA", "XB", "ZZ"].includes(code)) continue;
      codes.add(code);
      byName.set(name.toLowerCase(), code);
    }
  }
  byName.set("lebanese republic", "LB");
  byName.set("liban", "LB");
  byName.set("usa", "US");
  byName.set("uk", "GB");
  byName.set("uae", "AE");
};

export const isCountryCode = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  if (!codes) buildTables();
  return codes!.has(value.trim().toUpperCase());
};

/** "lb" / "LB" / "Lebanon" → "LB"; unknown text → null. */
export const toCountryCode = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  if (!codes) buildTables();
  const text = value.trim();
  if (text.length === 2 && codes!.has(text.toUpperCase())) return text.toUpperCase();
  return byName!.get(text.toLowerCase()) ?? null;
};
