import fs from "node:fs";
import { loadConfig, resolveProjectPath } from "../src/config/config.js";
import { createDatabase } from "../src/db/database.js";

const config = loadConfig();
const dbPath = resolveProjectPath(config.database.path);
fs.mkdirSync(new URL(".", `file://${dbPath}`).pathname, { recursive: true });
const db = createDatabase(dbPath);

db.setSyncState("walmart_orders", "manual_available", "Live Walmart order scraping is installed as a guarded adapter path but not verified.");
console.log("Order reconciliation local hooks are available.");
console.log("Live Walmart order scraping still requires a logged-in persistent Walmart session and manual verification.");
db.raw.close();
