import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";

describe("database reminder ingestion", () => {
  it("upserts reminders idempotently by external ID", () => {
    const db = createDatabase(":memory:");

    db.upsertReminder({
      externalId: "reminder-1",
      listId: "walmart-list",
      title: "milk",
      notes: null,
      completed: false
    });
    db.upsertReminder({
      externalId: "reminder-1",
      listId: "walmart-list",
      title: "milk edited",
      notes: "2%",
      completed: false
    });

    const reminders = db.listReminders();
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ external_id: "reminder-1", title: "milk edited" });
  });

  it("does not reset approved items back to parsed on the next reminder poll", () => {
    const db = createDatabase(":memory:");

    db.upsertReminder({
      externalId: "reminder-1",
      listId: "walmart-list",
      title: "milk",
      notes: null,
      completed: false
    });
    const item = db.listApprovals()[0];
    db.approveItem({
      itemId: Number(item.id),
      url: "https://www.walmart.com/ip/milk",
      title: "Usual Milk",
      chosenBy: "dashboard"
    });
    db.upsertReminder({
      externalId: "reminder-1",
      listId: "walmart-list",
      title: "milk",
      notes: null,
      completed: false
    });

    expect(db.listApprovals()).toHaveLength(0);
    const row = db.raw.prepare("select status from grocery_items where id = ?").get(item.id) as { status: string };
    expect(row.status).toBe("approved");
  });

  it("reparses edited approved reminder text for a fresh match", () => {
    const db = createDatabase(":memory:");

    db.upsertReminder({
      externalId: "reminder-edit-approved",
      listId: "walmart-list",
      title: "milk",
      notes: null,
      completed: false
    });
    const item = db.listApprovals()[0];
    db.approveItem({
      itemId: Number(item.id),
      url: "https://www.walmart.com/ip/milk",
      title: "Usual Milk",
      chosenBy: "dashboard"
    });

    db.upsertReminder({
      externalId: "reminder-edit-approved",
      listId: "walmart-list",
      title: "eggs",
      notes: null,
      completed: false
    });

    expect(db.listItems()[0]).toMatchObject({
      id: item.id,
      raw_text: "eggs",
      normalized_text: "eggs",
      status: "parsed",
      cart_status: "not_added",
      chosen_title: null
    });
    expect(db.getChosenProduct(Number(item.id))).toBeNull();
  });

  it("stores Walmart candidates and approves a specific candidate", () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({
      externalId: "reminder-candidate",
      listId: "walmart-list",
      title: "ranch mix",
      notes: null,
      completed: false
    });
    const item = db.listApprovals()[0];

    db.replaceCandidates(Number(item.id), [
      {
        title: "Hidden Valley Ranch Mix",
        url: "https://www.walmart.com/ip/ranch",
        walmartProductId: "ranch-123",
        priceText: "$2.48",
        sizeText: "1 oz",
        availabilityText: "Pickup",
        imageUrl: "https://example.test/ranch.jpg",
        confidence: 0.8,
        source: "walmart_search"
      }
    ]);
    const withCandidate = db.listApprovals()[0];
    expect(withCandidate).toMatchObject({
      candidate_title: "Hidden Valley Ranch Mix",
      candidate_image_url: "https://example.test/ranch.jpg"
    });

    db.approveItem({
      itemId: Number(item.id),
      candidateId: Number(withCandidate.candidate_id),
      walmartProductId: null,
      url: String(withCandidate.candidate_url),
      title: String(withCandidate.candidate_title),
      imageUrl: null,
      chosenBy: "dashboard"
    });

    const chosen = db.getChosenProduct(Number(item.id));
    expect(chosen).toMatchObject({
      url: "https://www.walmart.com/ip/ranch",
      title: "Hidden Valley Ranch Mix",
      walmart_product_id: "ranch-123"
    });
  });
});
