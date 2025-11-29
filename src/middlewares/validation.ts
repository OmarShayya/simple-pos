import { Request, Response, NextFunction } from "express";
import { plainToInstance } from "class-transformer";
import { validate, ValidationError } from "class-validator";
import { ApiError } from "../utils/apiError";

export const validateDto = (dtoClass: any) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dtoInstance = plainToInstance(dtoClass, req.body || {});
      const errors: ValidationError[] = await validate(dtoInstance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      if (errors.length > 0) {
        const messages = errors
          .map((error: ValidationError) =>
            Object.values(error.constraints || {}).join(", ")
          )
          .join("; ");
        throw ApiError.validation(messages);
      }

      req.body = dtoInstance;
      next();
    } catch (error) {
      next(error);
    }
  };
};
