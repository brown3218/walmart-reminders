import fs from "node:fs";
import { loadConfig, resolveProjectPath } from "../src/config/config.js";
import { createDatabase } from "../src/db/database.js";
import { scrapeReorderCandidates } from "../src/walmart/reorderCatalog.js";

const config = loadConfig();
const dbPath = resolveProjectPath(config.database.path);
fs.mkdirSync(new URL(".", `file://${dbPath}`).pathname, { recursive: true });
const db = createDatabase(dbPath);

try {
  db.setSyncState("walmart_catalog", "running");
  const candidates = await scrapeReorderCandidates(resolveProjectPath(config.walmart.profileDir));
  db.setSyncState("walmart_catalog", "ok");
  db.updateWalmartSession("ready", `Captured ${candidates.length} Walmart reorder candidates.`, false);
  console.log(`Captured ${candidates.length} Walmart reorder candidates.`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  db.setSyncState("walmart_catalog", "manual_action", message);
  db.updateWalmartSession("needs_manual_action", message, true);
  console.error(message);
  process.exitCode = 1;
} finally {
  db.raw.close();
}
