import type { AppDatabase, DashboardDeletion, ReminderInput } from "../db/database.js";

export type ReminderSnapshotResult = {
  created: number;
  updated: number;
  completed: number;
  missing: number;
  cartRemovals: DashboardDeletion[];
};

export function applyReminderSnapshot(db: AppDatabase, snapshot: ReminderInput[]): ReminderSnapshotResult {
  const previous = db.listReminders() as Array<{
    external_id: string;
    title: string;
    completed: number;
    deleted_at: string | null;
  }>;
  const previousActive = new Map(
    previous.filter((entry) => !entry.completed && !entry.deleted_at).map((entry) => [entry.external_id, entry])
  );
  const incomingIds = new Set(snapshot.map((entry) => entry.externalId));
  const result: ReminderSnapshotResult = { created: 0, updated: 0, completed: 0, missing: 0, cartRemovals: [] };

  for (const entry of snapshot) {
    const existing = previous.find((candidate) => candidate.external_id === entry.externalId);
    if (!existing) result.created += 1;
    else if (!entry.completed && existing.title !== entry.title) result.updated += 1;
    else if (entry.completed && !existing.completed) {
      result.completed += 1;
      const deletion = deleteActiveItemForReminder(db, entry.externalId);
      if (deletion?.needsCartRemoval) result.cartRemovals.push(deletion);
    }
    db.upsertReminder(entry);
  }

  for (const [externalId] of previousActive) {
    if (incomingIds.has(externalId)) continue;
    const deletion = deleteActiveItemForReminder(db, externalId);
    if (deletion) {
      if (deletion.needsCartRemoval) result.cartRemovals.push(deletion);
      result.missing += 1;
    }
  }

  return result;
}

function deleteActiveItemForReminder(db: AppDatabase, externalId: string): DashboardDeletion | null {
  const item = db.listItems().find((candidate) => candidate.external_id === externalId) as { id: number } | undefined;
  return item ? db.deleteItem(Number(item.id), "reminder_snapshot") : null;
}
