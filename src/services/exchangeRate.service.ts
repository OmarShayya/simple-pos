import ExchangeRate, { IExchangeRate } from "../models/exchangeRate.model";
import config from "../config/config";
import logger from "../utils/logger";

class ExchangeRateService {
  private currentRate: number = config.currency.exchangeRate;

  async getCurrentRate(): Promise<number> {
    return this.currentRate;
  }

  async updateRate(
    userId: string,
    newRate: number,
    notes?: string
  ): Promise<IExchangeRate> {
    const previousRate = this.currentRate;

    const exchangeRate = await ExchangeRate.create({
      rate: newRate,
      previousRate,
      updatedBy: userId,
      notes,
    });

    this.currentRate = newRate;
    config.currency.exchangeRate = newRate;

    logger.info(
      `Exchange rate updated from ${previousRate} to ${newRate} by user ${userId}`
    );

    return await exchangeRate.populate("updatedBy", "name email");
  }

  async getRateHistory(limit: number = 20): Promise<IExchangeRate[]> {
    return await ExchangeRate.find()
      .populate("updatedBy", "name email")
      .sort({ createdAt: -1 })
      .limit(limit);
  }

  async getLatestRate(): Promise<IExchangeRate | null> {
    return await ExchangeRate.findOne()
      .populate("updatedBy", "name email")
      .sort({ createdAt: -1 });
  }

  convertUsdToLbp(usdAmount: number): number {
    return usdAmount * this.currentRate;
  }

  convertLbpToUsd(lbpAmount: number): number {
    return lbpAmount / this.currentRate;
  }

  async initializeFromDatabase(): Promise<void> {
    const latestRate = await this.getLatestRate();
    if (latestRate) {
      this.currentRate = latestRate.rate;
      config.currency.exchangeRate = latestRate.rate;
      logger.info(
        `Exchange rate initialized from database: ${latestRate.rate}`
      );
    } else {
      logger.info(
        `No exchange rate in database, using config: ${this.currentRate}`
      );
    }
  }
}

export default new ExchangeRateService();
