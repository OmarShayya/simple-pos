import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError";
import { ErrorCode } from "../types";

/**
 * Tiny in-memory fixed-window rate limiter for public endpoints.
 * Good enough for a single server instance; swap for a shared store if the API is scaled out.
 */
export const rateLimit = (opts: { windowMs: number; max: number; message?: string }) => {
  const hits = new Map<string, { count: number; resetAt: number }>();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, opts.windowMs);
  sweep.unref?.();

  return (req: Request, _res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > opts.max) {
      return next(new ApiError(429, opts.message ?? "Too many requests, please try again later.", ErrorCode.RATE_LIMITED));
    }
    next();
  };
};
