import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type pino from "pino";
import type { AppConfig } from "../config/config.js";
import type { AppDatabase, DashboardDeletion } from "../db/database.js";
import { parseReminderJsonLines, parseReminderTsvLines } from "./ingest.js";
import {
  REMINDERS_HELPER_TIMEOUT_MS,
  buildAppleScriptReadReminderCommand,
  buildReadReminderCommand,
  type ReminderReadCommand
} from "./helper.js";
import { applyReminderSnapshot } from "./snapshot.js";

const execFileAsync = promisify(execFile);

type ReminderExecFile = (
  command: string,
  args: string[],
  options: { cwd: string; timeout: number; maxBuffer: number }
) => Promise<{ stdout: string | Buffer }>;

export type ReadReminderSnapshotResult = {
  reminders: ReturnType<typeof parseReminderTsvLines>;
  skipped: number;
  helper: "swift" | "applescript";
};

export type ReminderPollerOptions = {
  db: AppDatabase;
  config: AppConfig;
  logger: pino.Logger;
  afterPoll?: (result: ReminderPollResult) => void | Promise<void>;
  pollOnce?: (db: AppDatabase, config: AppConfig) => Promise<ReminderPollResult>;
};

export type ReminderPollResult = {
  ingested: number;
  skipped: number;
  cartRemovals: DashboardDeletion[];
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

export async function pollRemindersOnce(db: AppDatabase, config: AppConfig): Promise<ReminderPollResult> {
  const { reminders, skipped } = await readReminderSnapshot(config);
  const snapshot = applyReminderSnapshot(db, reminders);
  return { ingested: reminders.length, skipped, cartRemovals: snapshot.cartRemovals };
}

export async function readReminderSnapshot(
  config: AppConfig,
  options: { projectRoot?: string; execFile?: ReminderExecFile } = {}
): Promise<ReadReminderSnapshotResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const run = options.execFile ?? (execFileAsync as ReminderExecFile);
  const primary = buildReadReminderCommand(projectRoot, config.reminders.listNames);
  try {
    return await runReadCommand(primary, projectRoot, run);
  } catch (error) {
    if (primary.format !== "jsonl") throw error;
    return runReadCommand(buildAppleScriptReadReminderCommand(config.reminders.listNames), projectRoot, run);
  }
}

async function runReadCommand(
  command: ReminderReadCommand,
  projectRoot: string,
  execFileRunner: ReminderExecFile
): Promise<ReadReminderSnapshotResult> {
  const { stdout } = await execFileRunner(command.command, command.args, {
    cwd: projectRoot,
    timeout: REMINDERS_HELPER_TIMEOUT_MS,
    maxBuffer: 1024 * 1024
  });
  const output = String(stdout);
  const reminders = command.format === "jsonl" ? parseReminderJsonLines(output) : parseReminderTsvLines(output);
  const nonEmptyLines = output.split(/\r?\n/).filter((line) => line.trim()).length;
  return {
    reminders,
    skipped: nonEmptyLines - reminders.length,
    helper: command.format === "jsonl" ? "swift" : "applescript"
  };
}
