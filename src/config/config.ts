import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(__dirname, "../../.env") });

interface Config {
  env: string;
  port: number;
  apiPrefix: string;
  corsOrigin: string;
  logLevel: string;
  mongodbUri: string;
  jwt: {
    secret: string;
    expiresIn: string;
  };
  currency: {
    default: string;
    exchangeRate: number;
  };
}

const config: Config = {
  env: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "3000", 10),
  apiPrefix: process.env.API_PREFIX || "/api/v1",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  logLevel: process.env.LOG_LEVEL || "info",
  mongodbUri: process.env.MONGODB_URI || "mongodb://localhost:27017/pos_system",
  jwt: {
    secret: process.env.JWT_SECRET || "your-secret-key",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },
  currency: {
    default: process.env.DEFAULT_CURRENCY || "USD",
    exchangeRate: parseFloat(process.env.EXCHANGE_RATE_USD_TO_LBP || "89500"),
  },
};

export default config;
