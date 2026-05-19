import express from "express";
import { spawn } from "node:child_process";
import path from "node:path";
import type pino from "pino";
import { resolveProjectPath, type AppConfig } from "../config/config.js";
import type { AppDatabase } from "../db/database.js";
import { addMatchedItemToWalmart } from "../walmart/automation.js";
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
  app.use(express.static(path.resolve(process.cwd(), "public")));

  app.get("/api/health", (_req, res) => {
    const session = db.raw.prepare("select * from walmart_session_state where id = 1").get();
    res.json({ ok: true, walmartSession: session });
  });

  app.get("/api/approvals", requirePin(dashboardPin), (_req, res) => {
    res.json({ items: db.listApprovals() });
  });

  app.get("/api/history", requirePin(dashboardPin), (_req, res) => {
    res.json({ items: db.listHistory() });
  });

  app.post("/api/reminders", requirePin(dashboardPin), (req, res) => {
    db.upsertReminder(req.body);
    res.status(202).json({ ok: true });
  });

  app.post("/api/items/:id/approve", requirePin(dashboardPin), (req, res) => {
    const candidateId = req.body.candidateId ? Number(req.body.candidateId) : null;
    db.approveItem({
      itemId: Number(req.params.id),
      candidateId,
      url: req.body.url ?? "manual-review",
      title: req.body.title ?? "Approved item",
      chosenBy: "dashboard"
    });
    if (config && logger) {
      void addMatchedItemToWalmart(db, config, logger, Number(req.params.id));
    }
    res.status(202).json({ ok: true });
  });

  app.post("/api/items/:id/search", requirePin(dashboardPin), async (req, res, next) => {
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
      db.markItemFailed(Number(req.params.id), message);
      db.updateWalmartSession("needs_manual_login", message, true);
      res.status(409).json({ error: message });
    }
  });

  app.post("/api/walmart/open-session", requirePin(dashboardPin), (_req, res) => {
    const child = spawn("/usr/local/bin/npm", ["run", "walmart:login"], {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      env: { ...process.env, PATH: "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" }
    });
    child.unref();
    db.updateWalmartSession("login_window_opened", "Walmart login window opened on the Mac mini.", true);
    res.status(202).json({ ok: true });
  });

  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error.message });
  });

  app.post("/api/items/:id/reject", requirePin(dashboardPin), (req, res) => {
    db.rejectItem(Number(req.params.id));
    res.status(202).json({ ok: true });
  });

  app.post("/api/items/:id/mark-added", requirePin(dashboardPin), (req, res) => {
    db.markItemAdded(Number(req.params.id), "Marked added manually from dashboard.");
    res.status(202).json({ ok: true });
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
