import { Response, NextFunction } from "express";
import { CustomRequest } from "../types";
import exchangeRateService from "../services/exchangeRate.service";
import { ApiResponseUtil } from "../utils/apiResponse";
import { UpdateExchangeRateDto } from "../dtos/exchangeRate.dto";

class ExchangeRateController {
  async getCurrentRate(req: CustomRequest, res: Response, next: NextFunction) {
    const rate = await exchangeRateService.getCurrentRate();
    return ApiResponseUtil.success(
      res,
      { rate, currency: "USD to LBP" },
      "Current exchange rate retrieved successfully"
    );
  }

  async updateRate(req: CustomRequest, res: Response, next: NextFunction) {
    const { rate, notes }: UpdateExchangeRateDto = req.body;
    const userId = req.user!.id;

    const exchangeRate = await exchangeRateService.updateRate(
      userId,
      rate,
      notes
    );

    return ApiResponseUtil.success(
      res,
      {
        rate: exchangeRate.rate,
        previousRate: exchangeRate.previousRate,
        updatedBy: {
          name: (exchangeRate.updatedBy as any).name,
          email: (exchangeRate.updatedBy as any).email,
        },
        effectiveFrom: exchangeRate.effectiveFrom,
        notes: exchangeRate.notes,
      },
      "Exchange rate updated successfully"
    );
  }

  async getRateHistory(req: CustomRequest, res: Response, next: NextFunction) {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const history = await exchangeRateService.getRateHistory(limit);

    return ApiResponseUtil.success(
      res,
      history.map((record) => ({
        rate: record.rate,
        previousRate: record.previousRate,
        updatedBy: {
          name: (record.updatedBy as any).name,
          email: (record.updatedBy as any).email,
        },
        effectiveFrom: record.effectiveFrom,
        notes: record.notes,
        createdAt: record.createdAt,
      })),
      "Exchange rate history retrieved successfully"
    );
  }

  async convertCurrency(req: CustomRequest, res: Response, next: NextFunction) {
    const { amount, from } = req.query;

    if (!amount || !from) {
      return res.status(400).json({
        success: false,
        message: "Amount and from currency (USD or LBP) are required",
      });
    }

    const fromCurrency = (from as string).toUpperCase();
    const amountNum = Number(amount);

    let result: { usd: number; lbp: number };

    if (fromCurrency === "USD") {
      result = {
        usd: amountNum,
        lbp: exchangeRateService.convertUsdToLbp(amountNum),
      };
    } else if (fromCurrency === "LBP") {
      result = {
        usd: exchangeRateService.convertLbpToUsd(amountNum),
        lbp: amountNum,
      };
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid currency. Use USD or LBP",
      });
    }

    return ApiResponseUtil.success(
      res,
      {
        input: { amount: amountNum, currency: fromCurrency },
        result,
        rate: await exchangeRateService.getCurrentRate(),
      },
      "Currency converted successfully"
    );
  }
}

export default new ExchangeRateController();
