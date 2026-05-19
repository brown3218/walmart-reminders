import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type pino from "pino";
import type { AppConfig } from "../config/config.js";
import type { AppDatabase } from "../db/database.js";
import { parseReminderTsvLines } from "./ingest.js";
import { REMINDERS_HELPER_TIMEOUT_MS, buildReadReminderArgs } from "./helper.js";
import { applyReminderSnapshot } from "./snapshot.js";

const execFileAsync = promisify(execFile);

export type ReminderPollerOptions = {
  db: AppDatabase;
  config: AppConfig;
  logger: pino.Logger;
  afterPoll?: (result: { ingested: number; skipped: number }) => void | Promise<void>;
  pollOnce?: (db: AppDatabase, config: AppConfig) => Promise<{ ingested: number; skipped: number }>;
};

export function startReminderPoller({ db, config, logger, afterPoll, pollOnce = pollRemindersOnce }: ReminderPollerOptions): NodeJS.Timeout {
  let inFlight = false;
  const run = async () => {
    if (inFlight) {
      logger.warn("reminders poll skipped because previous poll is still running");
      return;
    }
    inFlight = true;
    try {
      const result = await pollOnce(db, config);
      await afterPoll?.(result);
      logger.info(result, "reminders poll complete");
    } catch (error) {
      logger.warn({ error: error instanceof Error ? error.message : String(error) }, "reminders poll failed");
    } finally {
      inFlight = false;
    }
  };

  void run();
  return setInterval(run, config.reminders.pollSeconds * 1000);
}

export async function pollRemindersOnce(db: AppDatabase, config: AppConfig): Promise<{ ingested: number; skipped: number }> {
  const { stdout } = await execFileAsync("osascript", buildReadReminderArgs("./scripts/read-reminders.applescript", config.reminders.listNames), {
    cwd: process.cwd(),
    timeout: REMINDERS_HELPER_TIMEOUT_MS,
    maxBuffer: 1024 * 1024
  });
  const reminders = parseReminderTsvLines(stdout);
  const nonEmptyLines = stdout.split(/\r?\n/).filter((line) => line.trim()).length;
  applyReminderSnapshot(db, reminders);
  return { ingested: reminders.length, skipped: nonEmptyLines - reminders.length };
}
