import type pino from "pino";
import { resolveProjectPath, type AppConfig } from "../config/config.js";
import type { AppDatabase, ReconciledFulfillment } from "../db/database.js";
import { applyFulfilledReminderDispositions } from "../orders/reminderCleanup.js";
import { scrapeRecentOrders } from "./orders.js";
import { runExclusiveWalmartProfileTask, type WalmartProfileQueueOptions } from "./profileQueue.js";
import { scrapeReorderCandidates, type WalmartReorderCandidate } from "./reorderCatalog.js";
import { enqueueAddMatchedItemToWalmart } from "./automation.js";
import type { OrderInput } from "../db/database.js";

type CatalogScraper = (profileDir: string) => Promise<WalmartReorderCandidate[]>;
type OrderScraper = (profileDir: string) => Promise<OrderInput[]>;

export async function runWalmartCatalogSync(input: {
  db: AppDatabase;
  config: AppConfig;
  logger: pino.Logger;
  scrape?: CatalogScraper;
  enqueueAdd?: (itemId: number) => void;
  profileQueue?: WalmartProfileQueueOptions;
}): Promise<{ candidates: number; matches: ReturnType<AppDatabase["matchPendingItems"]> }> {
  const scrape = input.scrape ?? scrapeReorderCandidates;
  const enqueueAdd = input.enqueueAdd ?? ((itemId) => enqueueAddMatchedItemToWalmart(input.db, input.config, input.logger, itemId));
  input.db.setSyncState("walmart_catalog", "running");
  try {
    const candidates = await runExclusiveWalmartProfileTask(
      () => scrape(resolveProjectPath(input.config.walmart.profileDir)),
      input.profileQueue
    );
    input.db.upsertCatalogItems(
      candidates.map((candidate) => ({
        productId: null,
        title: candidate.title,
        normalizedTitle: candidate.normalizedTitle,
        url: candidate.url,
        imageUrl: candidate.imageUrl,
        priceText: candidate.priceText,
        sizeText: null,
        brand: null,
        source: candidate.source ?? "reorder"
      }))
    );
    const matches = input.db.matchPendingItems({
      autoAddThreshold: input.config.walmart.autoAddThreshold,
      proposeThreshold: input.config.walmart.proposeThreshold
    });
    enqueueAutoMatchedItems(input.db, enqueueAdd);
    input.db.setSyncState("walmart_catalog", "ok");
    input.db.updateWalmartSession("ready", `Captured ${candidates.length} Walmart reorder items.`, false);
    return { candidates: candidates.length, matches };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.db.setSyncState("walmart_catalog", "manual_action", message);
    input.db.updateWalmartSession("needs_manual_action", message, true);
    throw error;
  }
}

export async function runWalmartOrderSync(input: {
  db: AppDatabase;
  config: AppConfig;
  logger: pino.Logger;
  scrape?: OrderScraper;
  applyReminderDispositions?: (input: {
    fulfilled: ReconciledFulfillment[];
    config: AppConfig;
    logger: pino.Logger;
  }) => Promise<void>;
  profileQueue?: WalmartProfileQueueOptions;
}): Promise<{ orders: number; fulfilled: ReconciledFulfillment[] }> {
  const scrape = input.scrape ?? scrapeRecentOrders;
  const applyReminderDispositions = input.applyReminderDispositions ?? applyFulfilledReminderDispositions;
  input.db.setSyncState("walmart_orders", "running");
  try {
    const orders = await runExclusiveWalmartProfileTask(
      () => scrape(resolveProjectPath(input.config.walmart.profileDir)),
      input.profileQueue
    );
    const stored = input.db.upsertOrders(orders);
    const fulfilled = input.db.reconcileOrders();
    await applyReminderDispositions({ fulfilled, config: input.config, logger: input.logger });
    input.db.setSyncState("walmart_orders", "ok");
    return { orders: stored, fulfilled };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.db.setSyncState("walmart_orders", "manual_action", message);
    input.db.updateWalmartSession("needs_manual_action", message, true);
    throw error;
  }
}

function enqueueAutoMatchedItems(db: AppDatabase, enqueueAdd: (itemId: number) => void): void {
  for (const item of db.listItems()) {
    if (item.status === "auto_matched" && item.cart_status === "not_added") {
      enqueueAdd(Number(item.id));
    }
  }
}
