import { z } from "zod";
import type { AppDatabase, ReminderInput } from "../db/database.js";

const reminderSnapshotSchema = z.object({
  externalId: z.string(),
  listId: z.string(),
  listName: z.string().nullable().optional(),
  title: z.string(),
  notes: z.string().nullable().optional(),
  completed: z.boolean()
});

export type ReminderIngestResult = {
  ingested: number;
  skipped: number;
};

export function ingestReminderJsonLines(db: AppDatabase, stdout: string): ReminderIngestResult {
  const reminders = parseReminderJsonLines(stdout);
  for (const reminder of reminders) db.upsertReminder(reminder);
  const nonEmptyLines = stdout.split(/\r?\n/).filter((line) => line.trim()).length;
  return { ingested: reminders.length, skipped: nonEmptyLines - reminders.length };
}

export function parseReminderJsonLines(stdout: string): ReminderInput[] {
  const reminders: ReminderInput[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = reminderSnapshotSchema.safeParse(json);
    if (!parsed.success) continue;
    reminders.push({
      externalId: parsed.data.externalId,
      listId: parsed.data.listId,
      listName: parsed.data.listName ?? null,
      title: parsed.data.title,
      notes: parsed.data.notes ?? null,
      completed: parsed.data.completed
    });
  }

  return reminders;
}

export function ingestReminderTsvLines(db: AppDatabase, stdout: string): ReminderIngestResult {
  const reminders = parseReminderTsvLines(stdout);
  for (const reminder of reminders) db.upsertReminder(reminder);
  const nonEmptyLines = stdout.split(/\r?\n/).filter((line) => line.trim()).length;
  return { ingested: reminders.length, skipped: nonEmptyLines - reminders.length };
}

export function parseReminderTsvLines(stdout: string): ReminderInput[] {
  const reminders: ReminderInput[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const hasListName = parts.length >= 6;
    const [externalId, listId] = parts;
    const listName = hasListName ? parts[2] : null;
    const title = hasListName ? parts[3] : parts[2];
    const notes = (hasListName ? parts[4] : parts[3]) ?? "";
    const completed = (hasListName ? parts[5] : parts[4]) ?? "false";
    if (!externalId || !listId || !title) continue;
    reminders.push({
      externalId,
      listId,
      listName,
      title,
      notes: notes || null,
      completed: completed === "true"
    });
  }

  return reminders;
}

export function ingestReminderTsvLinesLegacy(db: AppDatabase, stdout: string): ReminderIngestResult {
  let ingested = 0;
  let skipped = 0;

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [externalId, listId, title, notes = "", completed = "false"] = line.split("\t");
    if (!externalId || !listId || !title) {
      skipped += 1;
      continue;
    }
    db.upsertReminder({
      externalId,
      listId,
      title,
      notes: notes || null,
      completed: completed === "true"
    });
    ingested += 1;
  }

  return { ingested, skipped };
}
