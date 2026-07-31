import { serve } from "@hono/node-server";
import { loadConfig } from "./infra/config.js";
import { logger } from "./infra/logger.js";
import { initDb, closeDb, runMigrations } from "./infra/db/index.js";
import { initVulnHunterClient } from "./features/vulnhunter/index.js";
import { startScanLoops, stopScanLoops } from "./features/scans/index.js";
import { createApp } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info({ port: config.port, mock: config.vulnhunter.mock }, "Starting OpenVuln service");

  await initDb(config.db.url);
  await runMigrations();

  initVulnHunterClient(config);
  startScanLoops(config);

  const app = createApp(config);

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info({ port: info.port }, "OpenVuln listening");
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
    stopScanLoops();
    server.close();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to start");
  process.exit(1);
});
