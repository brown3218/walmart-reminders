import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/database.js";
import { createApp } from "../src/server/app.js";
import type { AppConfig } from "../src/config/config.js";

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

      const status = await fetch(`${baseUrl}/api/status`, {
        headers: { "x-dashboard-pin": "1234" }
      });
      expect(await status.json()).toMatchObject({
        server: { ok: true },
        counts: { needs_review: 0 }
      });

      const items = await fetch(`${baseUrl}/api/items`, {
        headers: { "x-dashboard-pin": "1234" }
      });
      expect(await items.json()).toMatchObject({ items: [] });
    } finally {
      server.close();
    }
  });

  it("allows EventSource clients to authenticate events with a PIN query parameter", async () => {
    const db = createDatabase(":memory:");
    const app = createApp({ db, dashboardPin: "1234" });
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const locked = await fetch(`${baseUrl}/api/events`);
      expect(locked.status).toBe(401);

      const response = await fetch(`${baseUrl}/api/events?pin=1234`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      await response.body?.cancel();
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
      expect(row.status).toBe("approved");
    } finally {
      server.close();
    }
  });

  it("approves a stored candidate by candidate ID without trusting browser-sent product details", async () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({
      externalId: "reminder-candidate-approval",
      listId: "walmart-list",
      title: "ranch mix",
      notes: null,
      completed: false
    });
    const item = db.listItems()[0];
    db.replaceCandidates(Number(item.id), [
      {
        walmartProductId: "ranch-123",
        title: "Hidden Valley Ranch Mix",
        url: "https://www.walmart.com/ip/ranch/123",
        priceText: "$2.48",
        sizeText: "1 oz",
        availabilityText: "Pickup",
        imageUrl: "https://example.test/ranch.jpg",
        confidence: 0.8,
        source: "walmart_search"
      }
    ]);
    const candidateId = Number(db.listItems()[0].candidate_id);
    const app = createApp({ db, dashboardPin: "1234" });
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/items/${item.id}/approve`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dashboard-pin": "1234"
        },
        body: JSON.stringify({ candidateId })
      });
      expect(response.status).toBe(202);

      expect(db.getChosenProduct(Number(item.id))).toMatchObject({
        walmart_product_id: "ranch-123",
        title: "Hidden Valley Ranch Mix",
        url: "https://www.walmart.com/ip/ranch/123",
        image_url: "https://example.test/ranch.jpg"
      });
    } finally {
      server.close();
    }
  });

  it("ignores spoofed browser product details when approving a stored candidate", async () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({
      externalId: "reminder-candidate-spoof",
      listId: "walmart-list",
      title: "yogurt",
      notes: null,
      completed: false
    });
    const item = db.listItems()[0];
    db.replaceCandidates(Number(item.id), [
      {
        walmartProductId: "yogurt-123",
        title: "Great Value Plain Yogurt",
        url: "https://www.walmart.com/ip/yogurt/123",
        priceText: "$3.24",
        sizeText: "32 oz",
        availabilityText: "Pickup",
        imageUrl: "https://example.test/yogurt.jpg",
        confidence: 0.82,
        source: "reorder"
      }
    ]);
    const candidateId = Number(db.listItems()[0].candidate_id);
    const app = createApp({ db, dashboardPin: "1234" });
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/items/${item.id}/approve`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dashboard-pin": "1234"
        },
        body: JSON.stringify({
          candidateId,
          walmartProductId: "spoofed-product",
          title: "Spoofed Product",
          url: "https://www.walmart.com/ip/spoofed/999",
          imageUrl: "https://example.test/spoofed.jpg"
        })
      });
      expect(response.status).toBe(202);

      expect(db.getChosenProduct(Number(item.id))).toMatchObject({
        walmart_product_id: "yogurt-123",
        title: "Great Value Plain Yogurt",
        url: "https://www.walmart.com/ip/yogurt/123",
        image_url: "https://example.test/yogurt.jpg"
      });
    } finally {
      server.close();
    }
  });

  it("refuses to approve generic Walmart search pages for cart automation", async () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({
      externalId: "reminder-search-approval",
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
        body: JSON.stringify({ url: "https://www.walmart.com/search?q=milk", title: "Search results" })
      });
      expect(approved.status).toBe(400);

      const row = db.raw.prepare("select status from grocery_items where id = ?").get(item.id) as { status: string };
      expect(row.status).toBe("parsed");
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
        status: "approved",
        chosen_title: "Hidden Valley Ranch Mix",
        chosen_url: "https://www.walmart.com/ip/ranch"
      });
    } finally {
      server.close();
    }
  });

  it("includes Walmart automation runs in dashboard activity history", async () => {
    const db = createDatabase(":memory:");
    db.recordAutomationRun("catalog_sync", "manual_action", "Walmart verification required.");
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

      expect(body.activity[0]).toMatchObject({
        type: "automation",
        action: "catalog_sync",
        status: "manual_action",
        title: "Catalog sync",
        detail: "Walmart verification required."
      });
    } finally {
      server.close();
    }
  });

  it("lets the user resume scheduled Walmart automation after manual verification", async () => {
    const db = createDatabase(":memory:");
    db.updateWalmartSession("needs_manual_action", "Walmart verification required.", true);
    const app = createApp({ db, dashboardPin: "1234" });
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/walmart/resume-session`, {
        method: "POST",
        headers: { "x-dashboard-pin": "1234" }
      });
      expect(response.status).toBe(202);

      expect(
        db.raw.prepare("select status, error_message, needs_manual_action from walmart_session_state where id = 1").get()
      ).toEqual({
        status: "manual_action_cleared",
        error_message: "Manual verification marked complete from dashboard. Scheduled Walmart automation may resume.",
        needs_manual_action: 0
      });
      expect(
        db.raw.prepare("select action, status, error_message from automation_runs order by id desc limit 1").get()
      ).toEqual({
        action: "manual_action_cleared",
        status: "ok",
        error_message: "Manual verification marked complete from dashboard. Scheduled Walmart automation may resume."
      });

      const history = await fetch(`${baseUrl}/api/history`, {
        headers: { "x-dashboard-pin": "1234" }
      });
      const body = await history.json();
      expect(body.activity[0]).toMatchObject({
        type: "automation",
        action: "manual_action_cleared",
        title: "Manual action cleared",
        status: "ok"
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
      expect(history.items[0]).toMatchObject({ raw_text: "milk", status: "added_to_cart" });
    } finally {
      server.close();
    }
  });

  it("chooses the current candidate when marking a proposed item manually added", async () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({
      externalId: "reminder-manual-candidate",
      listId: "walmart-list",
      title: "yogurt",
      notes: null,
      completed: false
    });
    const item = db.listItems()[0];
    db.replaceCandidates(Number(item.id), [
      {
        walmartProductId: "yogurt-123",
        title: "Great Value Plain Yogurt",
        url: "https://www.walmart.com/ip/yogurt/123",
        priceText: "$3.24",
        sizeText: "32 oz",
        availabilityText: "Pickup",
        imageUrl: "https://example.test/yogurt.jpg",
        confidence: 0.8,
        source: "reorder"
      }
    ]);
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

      expect(db.getChosenProduct(Number(item.id))).toMatchObject({
        walmart_product_id: "yogurt-123",
        title: "Great Value Plain Yogurt",
        url: "https://www.walmart.com/ip/yogurt/123",
        image_url: "https://example.test/yogurt.jpg",
        chosen_by: "manual"
      });
      expect(db.listItems()[0]).toMatchObject({ status: "added_to_cart", cart_status: "added" });
    } finally {
      server.close();
    }
  });

  it("supports sync, retry, mark ordered, delete, and search endpoints without live Walmart by reporting configured status", async () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({
      externalId: "reminder-endpoints",
      listId: "walmart-list",
      title: "deodorant",
      notes: null,
      completed: false
    });
    const item = db.listItems()[0];
    const app = createApp({ db, dashboardPin: "1234" });
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      for (const path of ["/api/sync/reminders", "/api/sync/walmart-catalog", "/api/sync/orders"]) {
        const response = await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "x-dashboard-pin": "1234" } });
        expect([202, 503]).toContain(response.status);
      }

      const retry = await fetch(`${baseUrl}/api/items/${item.id}/retry`, {
        method: "POST",
        headers: { "x-dashboard-pin": "1234" }
      });
      expect(retry.status).toBe(202);

      const ordered = await fetch(`${baseUrl}/api/items/${item.id}/mark-ordered`, {
        method: "POST",
        headers: { "x-dashboard-pin": "1234" }
      });
      expect(ordered.status).toBe(202);

      const deleted = await fetch(`${baseUrl}/api/items/${item.id}/delete`, {
        method: "POST",
        headers: { "x-dashboard-pin": "1234" }
      });
      expect(deleted.status).toBe(202);
    } finally {
      server.close();
    }
  });

  it("reports the configured reminder cleanup action when deleting from the dashboard", async () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({
      externalId: "reminder-delete-action",
      listId: "walmart-list",
      title: "yogurt",
      notes: null,
      completed: false
    });
    const item = db.listItems()[0];
    const app = createApp({
      db,
      dashboardPin: "1234",
      config: { reminders: { deleteAction: "delete", fulfillAction: "complete" } } as AppConfig
    });
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/items/${item.id}/delete`, {
        method: "POST",
        headers: { "x-dashboard-pin": "1234" }
      });
      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({
        reminder: { externalId: "reminder-delete-action", action: "delete" }
      });
    } finally {
      server.close();
    }
  });

  it("reports the configured reminder fulfill action when marking ordered from the dashboard", async () => {
    const db = createDatabase(":memory:");
    db.upsertReminder({
      externalId: "reminder-fulfill-action",
      listId: "walmart-list",
      title: "eggs",
      notes: null,
      completed: false
    });
    const item = db.listItems()[0];
    const app = createApp({
      db,
      dashboardPin: "1234",
      config: { reminders: { deleteAction: "complete", fulfillAction: "delete" } } as AppConfig
    });
    const server = app.listen(0);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing server port");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/api/items/${item.id}/mark-ordered`, {
        method: "POST",
        headers: { "x-dashboard-pin": "1234" }
      });
      expect(response.status).toBe(202);
      await expect(response.json()).resolves.toMatchObject({
        reminder: { externalId: "reminder-fulfill-action", action: "delete" }
      });
    } finally {
      server.close();
    }
  });
});
