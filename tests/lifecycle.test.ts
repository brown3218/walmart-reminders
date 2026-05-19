import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";

describe("item lifecycle and phrase mappings", () => {
  it("stores trusted phrase mappings after dashboard approval", () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({ externalId: "r1", listId: "walmart", title: "2x Great Value eggs", notes: null, completed: false });
    const item = db.listItems()[0];

    db.replaceCandidates(Number(item.id), [
      {
        title: "Great Value Large White Eggs, 18 Count",
        url: "https://www.walmart.com/ip/eggs",
        priceText: "$4.28",
        sizeText: "18 ct",
        availabilityText: "Pickup",
        imageUrl: "https://example.test/eggs.jpg",
        confidence: 0.88,
        source: "reorder"
      }
    ]);
    const candidate = db.listItems()[0];
    db.approveItem({
      itemId: Number(item.id),
      candidateId: Number(candidate.candidate_id),
      url: String(candidate.candidate_url),
      title: String(candidate.candidate_title),
      imageUrl: String(candidate.candidate_image_url),
      chosenBy: "dashboard"
    });

    expect(db.getTrustedMapping("great value eggs")).toMatchObject({
      title: "Great Value Large White Eggs, 18 Count",
      trusted: 1
    });
    expect(db.listItems({ includeInactive: true })[0]).toMatchObject({ status: "approved" });
  });

  it("tracks added, manual action, ordered, and fulfilled states", () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({ externalId: "r2", listId: "walmart", title: "yogurt", notes: null, completed: false });
    const item = db.listItems()[0];

    db.markItemManualAction(Number(item.id), "Walmart verification required.");
    expect(db.listItems()[0]).toMatchObject({ status: "manual_action", cart_status: "manual_action" });

    db.markItemAdded(Number(item.id), "Marked added manually.");
    expect(db.listItems()[0]).toMatchObject({ status: "added_to_cart", cart_status: "added" });

    db.markItemOrdered(Number(item.id), "Matched recent order.");
    db.fulfillItem(Number(item.id), "order");
    expect(db.listItems()).toEqual([]);
    expect(db.listItems({ includeInactive: true })[0]).toMatchObject({ status: "fulfilled" });
  });
});
