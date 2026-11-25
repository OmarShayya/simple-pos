import { localDateString } from "../utils/time";
import { getLoungeTimezone } from "./loungeSettings";

/**
 * Daily sequential codes like "20261125-0007" (invoice numbers, session numbers).
 * The date is the lounge's local date, and concurrent creates are retried on the unique index.
 */
const MAX_ATTEMPTS = 6;

const isDuplicateKey = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: number }).code === 11000;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface DailyCodeOptions<T> {
  /** Returns the highest existing code that starts with `prefix` (or null). */
  lastCode: (prefixPattern: RegExp) => Promise<string | null>;
  /** Persists the document using the generated code. */
  create: (code: string) => Promise<T>;
  now?: Date;
}

export const createWithDailyCode = async <T>(opts: DailyCodeOptions<T>): Promise<T> => {
  const tz = await getLoungeTimezone();
  const prefix = localDateString(opts.now ?? new Date(), tz).replace(/-/g, "");
  const pattern = new RegExp(`^${escapeRegex(prefix)}-\\d+$`);

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const last = await opts.lastCode(pattern);
    const lastSeq = last ? parseInt(last.slice(prefix.length + 1), 10) || 0 : 0;
    const code = `${prefix}-${String(lastSeq + 1).padStart(4, "0")}`;
    try {
      return await opts.create(code);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      lastError = error;
    }
  }
  throw lastError;
};
