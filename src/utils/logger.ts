import winston from "winston";
import config from "../config/config";

const logger = winston.createLogger({
  level: config.env === "development" ? "debug" : "warn",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.printf(
      (info) => `${info.timestamp} ${info.level}: ${info.message}`
    )
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.colorize({ all: true }),
    }),
  ],
});

export default logger;
