import type pino from "pino";
import type { AppDatabase } from "../db/database.js";
import { resolveProjectPath, type AppConfig } from "../config/config.js";
import { addApprovedItemToCart } from "./addToCart.js";

let queue = Promise.resolve();

export function enqueueAddMatchedItemToWalmart(
  db: AppDatabase,
  config: AppConfig,
  logger: pino.Logger,
  itemId: number
): void {
  queue = queue
    .catch(() => undefined)
    .then(() => addMatchedItemToWalmart(db, config, logger, itemId));
}

export async function addMatchedItemToWalmart(
  db: AppDatabase,
  config: AppConfig,
  logger: pino.Logger,
  itemId: number
): Promise<void> {
  const chosen = db.getChosenProduct(itemId);
  const url = String(chosen?.url ?? "");
  if (!url.startsWith("https://www.walmart.com/")) {
    db.markItemFailed(itemId, "No Walmart product URL is selected yet.");
    return;
  }

  db.markItemAdding(itemId);
  try {
    const result = await addApprovedItemToCart(resolveProjectPath(config.walmart.profileDir), url);
    if (result.status === "added") {
      db.markItemAdded(itemId, result.message);
    } else if (result.status === "needs_manual_action") {
      db.markItemManualAction(itemId, result.message);
    } else {
      db.markItemFailed(itemId, result.message);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ itemId, error: message }, "walmart add failed");
    db.markItemFailed(itemId, message);
  }
}
