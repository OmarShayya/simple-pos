import "reflect-metadata";
import app from "./app";
import config from "./config/config";
import logger from "./utils/logger";
import { connectDatabase } from "./config/database";
import exchangeRateService from "./services/exchangeRate.service";

const startServer = async () => {
  try {
    await connectDatabase();
    await exchangeRateService.initializeFromDatabase();

    const server = app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
      logger.info(`Environment: ${config.env}`);
      logger.info(`API Prefix: ${config.apiPrefix}`);
    });

    const gracefulShutdown = () => {
      logger.info("Shutting down gracefully...");
      server.close(() => {
        logger.info("Server closed");
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000);
    };

    process.on("SIGTERM", gracefulShutdown);
    process.on("SIGINT", gracefulShutdown);
    process.on("unhandledRejection", (reason: any) => {
      logger.error("Unhandled Rejection:", reason);
      gracefulShutdown();
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
