import { ErrorCode } from "../types";

export class ApiError extends Error {
  public statusCode: number;
  public errorCode: ErrorCode;
  public isOperational: boolean;

  constructor(
    statusCode: number,
    message: string,
    errorCode: ErrorCode = ErrorCode.INTERNAL_ERROR,
    isOperational = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string): ApiError {
    return new ApiError(400, message, ErrorCode.BAD_REQUEST);
  }

  static unauthorized(message: string = "Unauthorized"): ApiError {
    return new ApiError(401, message, ErrorCode.UNAUTHORIZED);
  }

  static forbidden(message: string = "Forbidden"): ApiError {
    return new ApiError(403, message, ErrorCode.FORBIDDEN);
  }

  static notFound(message: string = "Resource not found"): ApiError {
    return new ApiError(404, message, ErrorCode.NOT_FOUND);
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, message, ErrorCode.CONFLICT);
  }

  static validation(message: string): ApiError {
    return new ApiError(422, message, ErrorCode.VALIDATION_ERROR);
  }

  static internal(message: string = "Internal server error"): ApiError {
    return new ApiError(500, message, ErrorCode.INTERNAL_ERROR, false);
  }
}
