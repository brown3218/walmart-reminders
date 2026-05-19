import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type pino from "pino";
import type { AppConfig } from "../config/config.js";

const execFileAsync = promisify(execFile);

export async function applyReminderDisposition(
  config: AppConfig,
  logger: pino.Logger,
  input: { externalId: string; reason: "delete" | "fulfill" }
): Promise<void> {
  const action = input.reason === "fulfill" ? config.reminders.fulfillAction : config.reminders.deleteAction;
  try {
    await execFileAsync("osascript", ["./scripts/reminderctl.applescript", action, input.externalId], {
      cwd: process.cwd(),
      timeout: 15000,
      maxBuffer: 1024 * 128
    });
  } catch (error) {
    logger.warn(
      { externalId: input.externalId, action, error: error instanceof Error ? error.message : String(error) },
      "reminder disposition helper failed"
    );
  }
}
