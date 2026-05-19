import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { applyReminderSnapshot } from "../src/reminders/snapshot.js";

describe("applyReminderSnapshot", () => {
  it("creates, edits, completes, and tombstones reminders from a full snapshot", () => {
    const db = createDatabase(":memory:");

    const first = applyReminderSnapshot(db, [
      { externalId: "r1", listId: "walmart", title: "strawberries", notes: null, completed: false },
      { externalId: "r2", listId: "walmart", title: "yogurt", notes: null, completed: false }
    ]);
    expect(first).toMatchObject({ created: 2, updated: 0, completed: 0, missing: 0 });
    expect(db.listItems().map((item) => item.raw_text)).toEqual(["strawberries", "yogurt"]);

    const second = applyReminderSnapshot(db, [
      { externalId: "r1", listId: "walmart", title: "organic strawberries", notes: null, completed: false },
      { externalId: "r2", listId: "walmart", title: "yogurt", notes: null, completed: true }
    ]);
    expect(second).toMatchObject({ created: 0, updated: 1, completed: 1, missing: 0 });
    expect(db.listItems().map((item) => item.raw_text)).toEqual(["organic strawberries"]);

    const third = applyReminderSnapshot(db, []);
    expect(third).toMatchObject({ created: 0, updated: 0, completed: 0, missing: 1 });
    expect(db.listItems()).toEqual([]);
  });

  it("dashboard deletion marks a local tombstone for reminder helper propagation", () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({ externalId: "r3", listId: "walmart", title: "deodorant", notes: null, completed: false });

    const item = db.listItems()[0];
    const deletion = db.deleteItem(Number(item.id), "dashboard");

    expect(deletion).toMatchObject({ externalId: "r3", action: "complete" });
    expect(db.listItems()).toEqual([]);
    expect(db.raw.prepare("select deleted_at from reminders where external_id = 'r3'").get()).toMatchObject({
      deleted_at: expect.any(String)
    });
  });
});
