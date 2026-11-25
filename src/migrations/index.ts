import logger from "../utils/logger";
import pcService from "../services/pc.service";
import { migratePhones } from "./phones.migration";
import { migrateOrderItems } from "./orderItems.migration";

/**
 * Data migrations run on every start. Each one is idempotent (only touches rows still in the old
 * shape), so a restart is always safe. A failing migration is logged and doesn't stop the server.
 */
const steps: Array<{ name: string; run: () => Promise<unknown> }> = [
  {
    name: "station types",
    run: async () => {
      const migrated = await pcService.backfillStationTypes();
      if (migrated) logger.info(`[MIGRATION] Marked ${migrated} existing station(s) as type "pc"`);
    },
  },
  { name: "phone numbers", run: migratePhones },
  { name: "order lines", run: migrateOrderItems },
];

export const runStartupMigrations = async (): Promise<void> => {
  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      logger.error(`[MIGRATION] "${step.name}" failed — continuing startup`, error);
    }
  }
};
