import { Response, NextFunction } from "express";
import { CustomRequest } from "../types";
import authService from "../services/auth.service";
import { ApiError } from "../utils/apiError";
import { UserRole } from "../models/user.model";

export const authenticate = async (
  req: CustomRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      throw ApiError.unauthorized("No token provided");
    }

    const decoded = authService.verifyToken(token);
    const user = await authService.getUserById(decoded.id);

    req.user = {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    next();
  } catch (error) {
    next(error);
  }
};

export const authorize = (...roles: UserRole[]) => {
  return (req: CustomRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(ApiError.unauthorized("Not authenticated"));
    }

    if (!roles.includes(req.user.role as UserRole)) {
      return next(
        ApiError.forbidden("You do not have permission to perform this action")
      );
    }

    next();
  };
};
