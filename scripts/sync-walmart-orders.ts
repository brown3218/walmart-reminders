import fs from "node:fs";
import { loadConfig, resolveProjectPath } from "../src/config/config.js";
import { createDatabase } from "../src/db/database.js";
import { scrapeRecentOrders } from "../src/walmart/orders.js";

const config = loadConfig();
const dbPath = resolveProjectPath(config.database.path);
fs.mkdirSync(new URL(".", `file://${dbPath}`).pathname, { recursive: true });
const db = createDatabase(dbPath);

try {
  db.setSyncState("walmart_orders", "running");
  const orders = await scrapeRecentOrders(resolveProjectPath(config.walmart.profileDir));
  const stored = db.upsertOrders(orders);
  const fulfilled = db.reconcileOrders();
  db.setSyncState("walmart_orders", "ok");
  console.log(`Captured ${stored} Walmart orders.`);
  console.log(`Fulfilled ${fulfilled.length} matched reminder items.`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  db.setSyncState("walmart_orders", "manual_action", message);
  db.updateWalmartSession("needs_manual_action", message, true);
  console.error(message);
  process.exitCode = 1;
} finally {
  db.raw.close();
}
