import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { createApp } from "../src/server/app.js";

describe("dashboard API", () => {
  it("exposes health and approval queue", async () => {
    const db = createDatabase(":memory:");
    const app = createApp({ db, dashboardPin: "1234" });
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const health = await fetch(`${baseUrl}/api/health`);
      expect(await health.json()).toMatchObject({ ok: true });

      const approvals = await fetch(`${baseUrl}/api/approvals`, {
        headers: { "x-dashboard-pin": "1234" }
      });
      expect(await approvals.json()).toMatchObject({ items: [] });
    } finally {
      server.close();
    }
  });

  it("supports one-tap approval and rejection", async () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({
      externalId: "reminder-approval",
      listId: "walmart-list",
      title: "milk",
      notes: null,
      completed: false
    });

    const item = db.listApprovals()[0];
    const app = createApp({ db, dashboardPin: "1234" });
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const approved = await fetch(`${baseUrl}/api/items/${item.id}/approve`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dashboard-pin": "1234"
        },
        body: JSON.stringify({ url: "https://www.walmart.com/ip/milk", title: "Usual Milk" })
      });
      expect(approved.status).toBe(202);

      const row = db.raw.prepare("select status from grocery_items where id = ?").get(item.id) as { status: string };
      expect(row.status).toBe("matched");
    } finally {
      server.close();
    }
  });

  it("shows matched items in dashboard history with chosen product details", async () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({
      externalId: "reminder-history",
      listId: "walmart-list",
      title: "ranch mix",
      notes: null,
      completed: false
    });
    const item = db.listApprovals()[0];
    db.approveItem({
      itemId: Number(item.id),
      url: "https://www.walmart.com/ip/ranch",
      title: "Hidden Valley Ranch Mix",
      chosenBy: "dashboard"
    });

    const app = createApp({ db, dashboardPin: "1234" });
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/history`, {
        headers: { "x-dashboard-pin": "1234" }
      });
      const body = await response.json();
      expect(body.items[0]).toMatchObject({
        raw_text: "ranch mix",
        status: "matched",
        chosen_title: "Hidden Valley Ranch Mix",
        chosen_url: "https://www.walmart.com/ip/ranch"
      });
    } finally {
      server.close();
    }
  });

  it("lets the user mark an item added manually after opening Walmart", async () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({
      externalId: "reminder-manual",
      listId: "walmart-list",
      title: "milk",
      notes: null,
      completed: false
    });
    const item = db.listApprovals()[0];
    const app = createApp({ db, dashboardPin: "1234" });
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/items/${item.id}/mark-added`, {
        method: "POST",
        headers: { "x-dashboard-pin": "1234" }
      });
      expect(response.status).toBe(202);

      const history = await fetch(`${baseUrl}/api/history`, {
        headers: { "x-dashboard-pin": "1234" }
      }).then((r) => r.json());
      expect(history.items[0]).toMatchObject({ raw_text: "milk", status: "added" });
    } finally {
      server.close();
    }
  });
});
