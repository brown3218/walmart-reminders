import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";

describe("catalog persistence and pending item matching", () => {
  it("stores Walmart catalog items and proposes plausible reorder matches", () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({ externalId: "r1", listId: "walmart", title: "ranch mix", notes: null, completed: false });
    db.upsertCatalogItems([
      {
        productId: "ranch-1",
        title: "Hidden Valley Ranch Seasoning Mix, 1 oz",
        normalizedTitle: "hidden valley ranch seasoning mix 1 oz",
        url: "https://www.walmart.com/ip/ranch-1",
        imageUrl: "https://example.test/ranch.jpg",
        priceText: "$2.48",
        sizeText: "1 oz",
        brand: "Hidden Valley",
        source: "reorder"
      }
    ]);

    const result = db.matchPendingItems({ autoAddThreshold: 0.92, proposeThreshold: 0.45 });

    expect(result).toMatchObject({ autoMatched: 0, needsReview: 1, noMatch: 0 });
    expect(db.listItems()[0]).toMatchObject({
      status: "needs_review",
      candidate_title: "Hidden Valley Ranch Seasoning Mix, 1 oz",
      candidate_image_url: "https://example.test/ranch.jpg",
      candidate_source: "reorder"
    });
  });

  it("auto-matches trusted phrase mappings before fuzzy catalog matching", () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({ externalId: "r1", listId: "walmart", title: "eggs", notes: null, completed: false });
    const first = db.listItems()[0];
    db.approveItem({
      itemId: Number(first.id),
      url: "https://www.walmart.com/ip/eggs",
      title: "Great Value Eggs",
      imageUrl: "https://example.test/eggs.jpg",
      chosenBy: "dashboard"
    });

    db.upsertReminder({ externalId: "r2", listId: "walmart", title: "eggs", notes: null, completed: false });
    const result = db.matchPendingItems({ autoAddThreshold: 0.92, proposeThreshold: 0.45 });

    expect(result).toMatchObject({ autoMatched: 1 });
    const matched = db.listItems().find((item) => item.external_id === "r2");
    expect(matched).toMatchObject({
      status: "auto_matched",
      chosen_title: "Great Value Eggs",
      chosen_url: "https://www.walmart.com/ip/eggs"
    });
  });

  it("marks catalog misses as no_match instead of deleting reminders", () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({ externalId: "r1", listId: "walmart", title: "dragon fruit", notes: null, completed: false });

    const result = db.matchPendingItems({ autoAddThreshold: 0.92, proposeThreshold: 0.45 });

    expect(result).toMatchObject({ noMatch: 1 });
    expect(db.listItems()[0]).toMatchObject({ status: "no_match" });
  });

  it("keeps items unmatched when Walmart search returns no alternatives", () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({ externalId: "r1", listId: "walmart", title: "dragon fruit", notes: null, completed: false });
    const item = db.listItems()[0];

    db.replaceCandidates(Number(item.id), []);

    expect(db.listItems()[0]).toMatchObject({ status: "no_match", candidate_title: null });
  });
});
