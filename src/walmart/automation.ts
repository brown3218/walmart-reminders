import type pino from "pino";
import type { AppDatabase } from "../db/database.js";
import { resolveProjectPath, type AppConfig } from "../config/config.js";
import { addApprovedItemToCart, type AddToCartResult, type AddToCartTarget } from "./addToCart.js";
import { runExclusiveWalmartProfileTask } from "./profileQueue.js";
import { removeApprovedItemFromCart } from "./removeFromCart.js";
import { isWalmartProductUrl } from "./urls.js";

let addQueue = Promise.resolve();
let removeQueue = Promise.resolve();

export function enqueueAddMatchedItemToWalmart(
  db: AppDatabase,
  config: AppConfig,
  logger: pino.Logger,
  itemId: number
): void {
  addQueue = addQueue
    .catch(() => undefined)
    .then(() => addMatchedItemToWalmart(db, config, logger, itemId));
}

export function enqueueRemoveMatchedItemFromWalmart(
  db: AppDatabase,
  config: AppConfig,
  logger: pino.Logger,
  itemId: number
): void {
  removeQueue = removeQueue
    .catch(() => undefined)
    .then(() => removeMatchedItemFromWalmart(db, config, logger, itemId));
}

export async function addMatchedItemToWalmart(
  db: AppDatabase,
  config: AppConfig,
  logger: pino.Logger,
  itemId: number,
  options: {
    addToCart?: (profileDir: string, target: AddToCartTarget) => Promise<AddToCartResult>;
    runExclusive?: <T>(task: () => Promise<T>) => Promise<T>;
  } = {}
): Promise<void> {
  const chosen = db.getChosenProduct(itemId);
  const url = String(chosen?.url ?? "");
  if (!isWalmartProductUrl(url)) {
    db.markItemFailed(itemId, "No Walmart product URL is selected yet.");
    return;
  }

  db.markItemAdding(itemId);
  try {
    const addToCart = options.addToCart ?? addApprovedItemToCart;
    const runExclusive = options.runExclusive ?? runExclusiveWalmartProfileTask;
    const target = {
      productUrl: url,
      quantity: numericQuantity(chosen?.quantity_value)
    };
    const result = await runExclusive(() => addToCart(resolveProjectPath(config.walmart.profileDir), target));
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

function numericQuantity(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function removeMatchedItemFromWalmart(
  db: AppDatabase,
  config: AppConfig,
  logger: pino.Logger,
  itemId: number
): Promise<void> {
  const chosen = db.getChosenProduct(itemId);
  const title = String(chosen?.title ?? chosen?.raw_text ?? "");
  const url = chosen?.url ? String(chosen.url) : null;
  if (!title) return;

  try {
    const result = await runExclusiveWalmartProfileTask(() =>
      removeApprovedItemFromCart(resolveProjectPath(config.walmart.profileDir), { title, url })
    );
    if (result.status === "removed") {
      db.markItemCartRemoved(itemId, result.message);
    } else {
      db.markItemCartRemovalManual(itemId, result.message);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ itemId, error: message }, "walmart cart removal failed");
    db.markItemCartRemovalManual(itemId, message);
  }
}
