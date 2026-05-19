import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { ingestReminderJsonLines, parseReminderJsonLines } from "../src/reminders/ingest.js";
import { ingestReminderTsvLines } from "../src/reminders/ingest.js";

describe("ingestReminderJsonLines", () => {
  it("stores valid reminder snapshots and ignores invalid lines", () => {
    const db = createDatabase(":memory:");

    const result = ingestReminderJsonLines(
      db,
      [
        JSON.stringify({
          externalId: "abc",
          listId: "walmart",
          title: "bananas",
          notes: null,
          completed: false
        }),
        "not json"
      ].join("\n")
    );

    expect(result).toMatchObject({ ingested: 1, skipped: 1 });
    expect(db.listApprovals()[0]).toMatchObject({ raw_text: "bananas" });
  });

  it("parses Swift reminderctl JSON lines with list names for snapshot diffing", () => {
    expect(
      parseReminderJsonLines(
        JSON.stringify({
          externalId: "abc",
          listId: "list-1",
          listName: "Walmart shopping list",
          title: "strawberries",
          notes: null,
          completed: false
        })
      )
    ).toEqual([
      {
        externalId: "abc",
        listId: "list-1",
        listName: "Walmart shopping list",
        title: "strawberries",
        notes: null,
        completed: false
      }
    ]);
  });
});

describe("ingestReminderTsvLines", () => {
  it("stores reminders emitted by AppleScript", () => {
    const db = createDatabase(":memory:");

    const result = ingestReminderTsvLines(
      db,
      "x-apple-reminder://abc\tlist-1\tMilk\t2 percent\tfalse\nbroken"
    );

    expect(result).toMatchObject({ ingested: 1, skipped: 1 });
    expect(db.listApprovals()[0]).toMatchObject({ raw_text: "Milk" });
  });

  it("accepts list names emitted by the multi-list AppleScript reader", () => {
    const db = createDatabase(":memory:");

    const result = ingestReminderTsvLines(
      db,
      [
        "x-apple-reminder://abc\tlist-1\tWalmart\tMilk\t2 percent\tfalse",
        "x-apple-reminder://def\tlist-2\tWalmart shopping list\tYogurt\t\tfalse"
      ].join("\n")
    );

    expect(result).toMatchObject({ ingested: 2, skipped: 0 });
    expect(db.listReminders()).toEqual([
      expect.objectContaining({ external_id: "x-apple-reminder://abc", list_name: "Walmart", title: "Milk" }),
      expect.objectContaining({ external_id: "x-apple-reminder://def", list_name: "Walmart shopping list", title: "Yogurt" })
    ]);
  });
});
