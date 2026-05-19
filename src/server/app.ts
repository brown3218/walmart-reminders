import express from "express";
import { spawn } from "node:child_process";
import path from "node:path";
import type pino from "pino";
import { resolveProjectPath, type AppConfig } from "../config/config.js";
import type { AppDatabase } from "../db/database.js";
import { applyReminderDisposition } from "../reminders/actions.js";
import { pollRemindersOnce } from "../reminders/poller.js";
import { enqueueAddMatchedItemToWalmart, enqueueRemoveMatchedItemFromWalmart } from "../walmart/automation.js";
import { scrapeRecentOrders } from "../walmart/orders.js";
import { scrapeReorderCandidates } from "../walmart/reorderCatalog.js";
import { searchWalmartProducts } from "../walmart/search.js";

export type CreateAppOptions = {
  db: AppDatabase;
  dashboardPin: string | null;
  config?: AppConfig;
  logger?: pino.Logger;
};

export function createApp({ db, dashboardPin, config, logger }: CreateAppOptions): express.Express {
  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    const session = db.raw.prepare("select * from walmart_session_state where id = 1").get();
    res.json({ ok: true, walmartSession: session, time: new Date().toISOString() });
  });

  app.get("/api/status", requirePin(dashboardPin), (_req, res) => {
    const session = db.raw.prepare("select * from walmart_session_state where id = 1").get();
    res.json({
      server: { ok: true, time: new Date().toISOString() },
      walmartSession: session,
      syncState: db.listSyncState(),
      counts: db.countsByStatus()
    });
  });

  app.get("/api/items", requirePin(dashboardPin), (_req, res) => {
    res.json({ items: db.listItems() });
  });

  app.get("/api/approvals", requirePin(dashboardPin), (_req, res) => {
    res.json({ items: db.listApprovals() });
  });

  app.get("/api/history", requirePin(dashboardPin), (_req, res) => {
    res.json({ items: db.listHistory() });
  });

  app.get("/api/events", requirePin(dashboardPin), (req, res) => {
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");
    const send = () => {
      res.write("event: status\n");
      res.write(`data: ${JSON.stringify({ counts: db.countsByStatus(), time: new Date().toISOString() })}\n\n`);
    };
    send();
    const timer = setInterval(send, 5000);
    req.on("close", () => clearInterval(timer));
  });

  app.post("/api/reminders", requirePin(dashboardPin), (req, res) => {
    db.upsertReminder(req.body);
    res.status(202).json({ ok: true });
  });

  app.post("/api/sync/reminders", requirePin(dashboardPin), async (_req, res) => {
    if (!config || !logger) {
      res.status(503).json({ error: "Reminder sync is not configured in this process." });
      return;
    }
    try {
      db.setSyncState("reminders", "running");
      const result = await pollRemindersOnce(db, config);
      const matches = db.matchPendingItems({
        autoAddThreshold: config.walmart.autoAddThreshold,
        proposeThreshold: config.walmart.proposeThreshold
      });
      enqueueAutoMatchedItems(db, config, logger);
      db.setSyncState("reminders", "ok");
      res.status(202).json({ ok: true, result, matches });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.setSyncState("reminders", "failed", message);
      logger.warn({ error: message }, "manual reminders sync failed");
      res.status(503).json({ error: message });
    }
  });

  app.post("/api/sync/walmart-catalog", requirePin(dashboardPin), async (_req, res) => {
    if (!config) {
      res.status(503).json({ error: "Walmart catalog sync is not configured in this process." });
      return;
    }
    try {
      db.setSyncState("walmart_catalog", "running");
      const candidates = await scrapeReorderCandidates(resolveProjectPath(config.walmart.profileDir));
      db.upsertCatalogItems(
        candidates.map((candidate) => ({
          productId: null,
          title: candidate.title,
          normalizedTitle: candidate.normalizedTitle,
          url: candidate.url,
          imageUrl: candidate.imageUrl,
          priceText: candidate.priceText,
          sizeText: null,
          brand: null,
          source: "reorder"
        }))
      );
      const matches = db.matchPendingItems({
        autoAddThreshold: config.walmart.autoAddThreshold,
        proposeThreshold: config.walmart.proposeThreshold
      });
      if (logger) enqueueAutoMatchedItems(db, config, logger);
      db.setSyncState("walmart_catalog", "ok");
      db.updateWalmartSession("ready", `Captured ${candidates.length} Walmart reorder items.`, false);
      res.status(202).json({ ok: true, candidates: candidates.length, matches });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.setSyncState("walmart_catalog", "manual_action", message);
      db.updateWalmartSession("needs_manual_action", message, true);
      res.status(409).json({ error: message });
    }
  });

  app.post("/api/sync/orders", requirePin(dashboardPin), async (_req, res) => {
    if (!config || !logger) {
      res.status(503).json({ error: "Walmart order sync is not configured in this process." });
      return;
    }
    try {
      db.setSyncState("walmart_orders", "running");
      const orders = await scrapeRecentOrders(resolveProjectPath(config.walmart.profileDir));
      const stored = db.upsertOrders(orders);
      const fulfilled = db.reconcileOrders();
      db.setSyncState("walmart_orders", "ok");
      res.status(202).json({ ok: true, orders: stored, fulfilled });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.setSyncState("walmart_orders", "manual_action", message);
      db.updateWalmartSession("needs_manual_action", message, true);
      logger.warn({ error: message }, "walmart order sync needs manual action");
      res.status(409).json({ error: message });
    }
  });

  app.post("/api/items/:id/approve", requirePin(dashboardPin), (req, res) => {
    const itemId = Number(req.params.id);
    db.approveItem({
      itemId,
      candidateId: req.body.candidateId ? Number(req.body.candidateId) : null,
      walmartProductId: req.body.walmartProductId ?? null,
      url: req.body.url ?? "manual-review",
      title: req.body.title ?? "Approved item",
      imageUrl: req.body.imageUrl ?? null,
      chosenBy: "dashboard"
    });
    if (config && logger) {
      enqueueAddMatchedItemToWalmart(db, config, logger, itemId);
    }
    res.status(202).json({ ok: true });
  });

  app.post("/api/items/:id/reject", requirePin(dashboardPin), (req, res) => {
    db.rejectItem(Number(req.params.id));
    res.status(202).json({ ok: true });
  });

  app.post("/api/items/:id/delete", requirePin(dashboardPin), (req, res) => {
    const deletion = db.deleteItem(Number(req.params.id), "dashboard");
    if (deletion.needsCartRemoval && config && logger) {
      enqueueRemoveMatchedItemFromWalmart(db, config, logger, deletion.itemId);
    }
    if (config && logger) {
      void applyReminderDisposition(config, logger, { externalId: deletion.externalId, reason: "delete" });
    }
    res.status(202).json({ ok: true, reminder: deletion });
  });

  app.post("/api/items/:id/retry", requirePin(dashboardPin), (req, res) => {
    const itemId = Number(req.params.id);
    db.resetItemForRetry(itemId);
    if (config && logger && db.getChosenProduct(itemId)) {
      enqueueAddMatchedItemToWalmart(db, config, logger, itemId);
    }
    res.status(202).json({ ok: true });
  });

  app.post("/api/items/:id/mark-added", requirePin(dashboardPin), (req, res) => {
    db.markItemAdded(Number(req.params.id), "Marked added manually from dashboard.");
    res.status(202).json({ ok: true });
  });

  app.post("/api/items/:id/mark-ordered", requirePin(dashboardPin), (req, res) => {
    const itemId = Number(req.params.id);
    db.markItemOrdered(itemId, "Marked ordered manually from dashboard.");
    const deletion = db.fulfillItem(itemId, "dashboard");
    if (deletion && config && logger) {
      void applyReminderDisposition(config, logger, { externalId: deletion.externalId, reason: "fulfill" });
    }
    res.status(202).json({ ok: true });
  });

  app.post("/api/items/:id/search", requirePin(dashboardPin), async (req, res) => {
    if (!config) {
      res.status(503).json({ error: "Walmart search is not configured." });
      return;
    }
    try {
      const item = db.raw.prepare("select raw_text from grocery_items where id = ?").get(Number(req.params.id)) as
        | { raw_text: string }
        | undefined;
      if (!item) {
        res.status(404).json({ error: "Item not found." });
        return;
      }
      const candidates = await searchWalmartProducts(resolveProjectPath(config.walmart.profileDir), item.raw_text);
      db.replaceCandidates(Number(req.params.id), candidates);
      db.updateWalmartSession("ready", null, false);
      res.status(202).json({ ok: true, candidates: candidates.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.markItemManualAction(Number(req.params.id), message);
      db.updateWalmartSession("needs_manual_action", message, true);
      res.status(409).json({ error: message });
    }
  });

  app.post("/api/walmart/open-session", requirePin(dashboardPin), (_req, res) => {
    const child = spawn("npm", ["run", "walmart:login"], {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PATH: "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" }
    });
    child.unref();
    db.updateWalmartSession("login_window_opened", "Walmart login window opened on the Mac mini.", true);
    res.status(202).json({ ok: true });
  });

  app.use(express.static(path.resolve(process.cwd(), "public")));

  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error.message });
  });

  return app;
}

function requirePin(pin: string | null): express.RequestHandler {
  return (req, res, next) => {
    if (!pin) return next();
    if (req.header("x-dashboard-pin") === pin) return next();
    res.status(401).json({ error: "dashboard PIN required" });
  };
}

function enqueueAutoMatchedItems(db: AppDatabase, config: AppConfig, logger: pino.Logger): void {
  for (const item of db.listItems()) {
    if (item.status === "auto_matched" && item.cart_status === "not_added") {
      enqueueAddMatchedItemToWalmart(db, config, logger, Number(item.id));
    }
  }
}
