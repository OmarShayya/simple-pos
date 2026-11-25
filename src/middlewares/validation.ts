import { Request, Response, NextFunction } from "express";
import { ClassConstructor, plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { ApiError } from "../utils/apiError";

const flatten = (errors: ValidationError[], prefix = ""): string[] =>
  errors.flatMap((error) => {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    const own = Object.values(error.constraints || {});
    const nested = error.children?.length ? flatten(error.children, path) : [];
    return [...own, ...nested];
  });

export const validateDto = (dtoClass: ClassConstructor<object>) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dtoInstance = plainToInstance(dtoClass, req.body || {});
      const errors: ValidationError[] = await validate(dtoInstance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      if (errors.length > 0) {
        throw ApiError.validation(flatten(errors).join("; "));
      }

      req.body = dtoInstance;
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Validates `req.query` against a DTO (unknown parameters are ignored).
 * Express 5 makes `req.query` read-only, so the typed result is put on `res.locals.query`.
 */
export const validateQuery = (dtoClass: ClassConstructor<object>) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dtoInstance = plainToInstance(dtoClass, { ...req.query });
      const errors = await validate(dtoInstance, { whitelist: true, forbidNonWhitelisted: false });
      if (errors.length > 0) throw ApiError.badRequest(flatten(errors).join("; "));
      res.locals.query = dtoInstance;
      next();
    } catch (error) {
      next(error);
    }
  };
};
