import fs from "node:fs";
import pino from "pino";
import { loadConfig, resolveProjectPath } from "./config/config.js";
import { createDatabase } from "./db/database.js";
import { startReminderPoller } from "./reminders/poller.js";
import { createApp } from "./server/app.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const config = loadConfig();
const dbPath = resolveProjectPath(config.database.path);
fs.mkdirSync(new URL(".", `file://${dbPath}`).pathname, { recursive: true });

const db = createDatabase(dbPath);
const app = createApp({ db, dashboardPin: config.dashboard.pin, config, logger });
startReminderPoller({ db, config, logger });

app.listen(config.dashboard.port, config.dashboard.host, () => {
  logger.info(
    {
      host: config.dashboard.host,
      port: config.dashboard.port,
      dbPath,
      mode: config.walmart.mode
    },
    "walmart-reminders dashboard started"
  );
});
