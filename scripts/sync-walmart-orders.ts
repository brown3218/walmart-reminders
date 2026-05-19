import fs from "node:fs";
import pino from "pino";
import { loadConfig, resolveProjectPath } from "../src/config/config.js";
import { createDatabase } from "../src/db/database.js";
import { runWalmartOrderSync } from "../src/walmart/sync.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const config = loadConfig();
const dbPath = resolveProjectPath(config.database.path);
fs.mkdirSync(new URL(".", `file://${dbPath}`).pathname, { recursive: true });
const db = createDatabase(dbPath);

try {
  const result = await runWalmartOrderSync({ db, config, logger });
  console.log(`Captured ${result.orders} Walmart orders.`);
  console.log(`Fulfilled ${result.fulfilled.length} matched reminder items.`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
} finally {
  db.raw.close();
}
