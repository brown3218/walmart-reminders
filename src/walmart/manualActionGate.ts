import type { AppDatabase } from "../db/database.js";

export const walmartManualActionPendingMessage =
  "Walmart needs manual login or human verification before automation can continue.";

export function isWalmartManualActionPending(db: Pick<AppDatabase, "raw">): boolean {
  const row = db.raw
    .prepare("select needs_manual_action from walmart_session_state where id = 1")
    .get() as { needs_manual_action?: number } | undefined;
  return Number(row?.needs_manual_action ?? 0) === 1;
}
