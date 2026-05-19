import { z } from "zod";
import type { AppDatabase, ReminderInput } from "../db/database.js";

const reminderSnapshotSchema = z.object({
  externalId: z.string(),
  listId: z.string(),
  title: z.string(),
  notes: z.string().nullable().optional(),
  completed: z.boolean()
});

export type ReminderIngestResult = {
  ingested: number;
  skipped: number;
};

export function ingestReminderJsonLines(db: AppDatabase, stdout: string): ReminderIngestResult {
  let ingested = 0;
  let skipped = 0;

  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    const parsed = reminderSnapshotSchema.safeParse(json);
    if (!parsed.success) {
      skipped += 1;
      continue;
    }
    db.upsertReminder({
      externalId: parsed.data.externalId,
      listId: parsed.data.listId,
      title: parsed.data.title,
      notes: parsed.data.notes ?? null,
      completed: parsed.data.completed
    });
    ingested += 1;
  }

  return { ingested, skipped };
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
    const [externalId, listId, title, notes = "", completed = "false"] = line.split("\t");
    if (!externalId || !listId || !title) continue;
    reminders.push({
      externalId,
      listId,
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
