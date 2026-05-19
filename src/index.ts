import fs from "node:fs";
import https from "node:https";
import pino from "pino";
import { loadConfig, resolveProjectPath } from "./config/config.js";
import { createDatabase } from "./db/database.js";
import type { DashboardDeletion } from "./db/database.js";
import { buildDashboardUrls, detectBonjourHost, pickLanAddress } from "./network/urls.js";
import { startReminderPoller } from "./reminders/poller.js";
import { createApp } from "./server/app.js";
import { enqueueAddMatchedItemToWalmart, enqueueRemoveMatchedItemFromWalmart } from "./walmart/automation.js";
import { isWalmartManualActionPending } from "./walmart/manualActionGate.js";
import { startWalmartSyncJobs } from "./walmart/scheduler.js";
import { runWalmartCatalogSync, runWalmartOrderSync } from "./walmart/sync.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const config = loadConfig();
const dbPath = resolveProjectPath(config.database.path);
fs.mkdirSync(new URL(".", `file://${dbPath}`).pathname, { recursive: true });

const db = createDatabase(dbPath);
const app = createApp({ db, dashboardPin: config.dashboard.pin, config, logger });
startReminderPoller({
  db,
  config,
  logger,
  afterPoll: (result) => {
    const matches = db.matchPendingItems({
      autoAddThreshold: config.walmart.autoAddThreshold,
      proposeThreshold: config.walmart.proposeThreshold
    });
    enqueueAutoMatchedItems();
    enqueueReminderDrivenCartRemovals(result.cartRemovals);
    logger.info(matches, "pending reminders matched after poll");
  }
});

startWalmartSyncJobs({
  config,
  logger,
  shouldRun: () => !isWalmartManualActionPending(db),
  onSkipped: (name) => {
    const action = name === "walmart catalog sync" ? "catalog_sync" : "order_check";
    db.recordAutomationRun(action, "manual_action", "Paused while Walmart manual action is pending.");
  },
  runCatalog: async () => {
    const result = await runWalmartCatalogSync({ db, config, logger });
    logger.info(result, "walmart catalog sync complete");
  },
  runOrders: async () => {
    const result = await runWalmartOrderSync({ db, config, logger });
    logger.info(result, "walmart order sync complete");
  }
});

app.listen(config.dashboard.port, config.dashboard.host, () => {
  const lanAddress = pickLanAddress();
  const urls = buildDashboardUrls({
    port: config.dashboard.port,
    lanAddress,
    bonjourHost: detectBonjourHost("mac-mini.local"),
    httpsPort: config.dashboard.https.enabled ? config.dashboard.https.port : null
  });
  logger.info(
    {
      host: config.dashboard.host,
      port: config.dashboard.port,
      dbPath,
      mode: config.walmart.mode,
      urls
    },
    "walmart-reminders dashboard started"
  );
  console.log(`Local Mac URL: ${urls.local}`);
  if (urls.lan) console.log(`iPhone LAN URL: ${urls.lan}`);
  if (urls.bonjour) console.log(`Bonjour URL: ${urls.bonjour}`);
});

if (config.dashboard.https.enabled) {
  const certPath = resolveProjectPath(config.dashboard.https.certPath);
  const keyPath = resolveProjectPath(config.dashboard.https.keyPath);
  try {
    const server = https.createServer(
      {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath)
      },
      app
    );
    server.listen(config.dashboard.https.port, config.dashboard.host, () => {
      logger.info(
        { host: config.dashboard.host, port: config.dashboard.https.port, certPath, keyPath },
        "walmart-reminders HTTPS dashboard started"
      );
    });
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), certPath, keyPath },
      "HTTPS dashboard requested but certificate files could not be loaded"
    );
  }
}

function enqueueAutoMatchedItems(): void {
  for (const item of db.listItems()) {
    if (item.status === "auto_matched" && item.cart_status === "not_added") {
      enqueueAddMatchedItemToWalmart(db, config, logger, Number(item.id));
    }
  }
}

function enqueueReminderDrivenCartRemovals(removals: DashboardDeletion[]): void {
  for (const removal of removals) {
    if (removal.needsCartRemoval) {
      enqueueRemoveMatchedItemFromWalmart(db, config, logger, removal.itemId, cartRemovalTarget(removal));
    }
  }
}

function cartRemovalTarget(removal: DashboardDeletion): { title: string; url: string | null } | undefined {
  return removal.productTitle ? { title: removal.productTitle, url: removal.productUrl ?? null } : undefined;
}
