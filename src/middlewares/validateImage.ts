import { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/apiError";

export const validateImageUrl = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { image } = req.body;

  if (image && image.trim() !== "") {
    const firebasePattern = /^https:\/\/firebasestorage\.googleapis\.com\/.+/;

    if (!firebasePattern.test(image)) {
      throw ApiError.badRequest("Invalid Firebase Storage URL");
    }
  }

  next();
};
