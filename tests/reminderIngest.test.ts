import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { ingestReminderJsonLines } from "../src/reminders/ingest.js";
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
});
