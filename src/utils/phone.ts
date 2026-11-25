import { CountryCode, getCountryCallingCode, isSupportedCountry, parsePhoneNumberFromString } from "libphonenumber-js";
import { ApiError } from "./apiError";

/** The lounge is in Lebanon: numbers typed without a country code are Lebanese. */
export const DEFAULT_PHONE_COUNTRY = "LB";
export const INVALID_PHONE_MESSAGE = "Please enter a valid phone number";

export interface NormalizedPhone {
  /** "+96170123456" */
  e164: string;
  /** ISO-3166 alpha-2, e.g. "LB" */
  country: string;
  /** National significant number, digits only, e.g. "70123456" (03 555 777 → "3555777") */
  national: string;
}

export const phoneDigits = (value: string): string => value.replace(/\D/g, "");

/** Last 8 digits: a format-independent key used for legacy (un-normalized) rows. */
export const phoneKeyOf = (value: string): string => phoneDigits(value).slice(-8);

const toCountry = (value: string | undefined | null): CountryCode => {
  const code = (value || "").trim().toUpperCase();
  return isSupportedCountry(code) ? (code as CountryCode) : DEFAULT_PHONE_COUNTRY;
};

const tryParse = (text: string, country: CountryCode): NormalizedPhone | null => {
  const parsed = parsePhoneNumberFromString(text, country);
  if (!parsed || !parsed.isValid()) return null;
  // Several countries share a calling code (+44: GB, GG, JE, IM; +1: US, CA…). When the number fits the
  // country the person picked, keep their choice instead of the one libphonenumber guesses from the range.
  const sharesCode = parsed.countryCallingCode === getCountryCallingCode(country);
  return {
    e164: parsed.number,
    country: sharesCode ? country : (parsed.country ?? country),
    national: String(parsed.nationalNumber),
  };
};

/**
 * Normalizes a phone number typed in any common format to E.164.
 * Accepts "+961 70 123 456", "70123456", "0096170123456", "03 555 777", "961 70 123 456"…
 * Returns null when the number can't be a real phone number.
 */
export const normalizePhone = (
  input: unknown,
  defaultCountry: string | null | undefined = DEFAULT_PHONE_COUNTRY
): NormalizedPhone | null => {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 40) return null;

  // "00" is the international dialling prefix used in Lebanon and most of the world
  const text = trimmed.replace(/^\s*00/, "+");
  const country = toCountry(defaultCountry);

  const direct = tryParse(text, country);
  if (direct) return direct;

  // "96170123456" typed without the "+"
  const digits = phoneDigits(text);
  if (!text.startsWith("+") && digits.length > 8) return tryParse(`+${digits}`, country);
  return null;
};

/** Like normalizePhone, but throws a 400 the client can show as-is. */
export const requirePhone = (input: unknown, defaultCountry?: string | null): NormalizedPhone => {
  const phone = normalizePhone(input, defaultCountry ?? DEFAULT_PHONE_COUNTRY);
  if (!phone) throw ApiError.badRequest(INVALID_PHONE_MESSAGE);
  return phone;
};

/** Is this an ISO-3166 alpha-2 code libphonenumber knows? */
export const isPhoneCountry = (value: unknown): boolean =>
  typeof value === "string" && isSupportedCountry(value.toUpperCase());

/**
 * Digit fragments a stored E.164 number would contain for a free-text search term
 * ("70 123", "0096170…", "03 555 777" all find "+9613555777"/"+96170123456").
 */
export const phoneSearchFragments = (term: string): string[] => {
  const digits = phoneDigits(term);
  if (digits.length < 3) return [];
  const fragments = new Set<string>([digits, digits.replace(/^0+/, "")]);
  const parsed = normalizePhone(term);
  if (parsed) fragments.add(phoneDigits(parsed.e164));
  return [...fragments].filter((f) => f.length >= 3);
};
