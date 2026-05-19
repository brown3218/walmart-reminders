import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type pino from "pino";
import type { AppConfig } from "../config/config.js";
import { buildAppleScriptReminderDispositionCommand, buildReminderDispositionCommand } from "./helper.js";

const execFileAsync = promisify(execFile);

export async function applyReminderDisposition(
  config: AppConfig,
  logger: pino.Logger,
  input: { externalId: string; reason: "delete" | "fulfill" }
): Promise<void> {
  const action = input.reason === "fulfill" ? config.reminders.fulfillAction : config.reminders.deleteAction;
  try {
    const command = buildReminderDispositionCommand(process.cwd(), action, input.externalId);
    try {
      await runDispositionCommand(command);
    } catch (error) {
      const fallback = buildAppleScriptReminderDispositionCommand(action, input.externalId);
      if (fallback.command === command.command) throw error;
      await runDispositionCommand(fallback);
    }
  } catch (error) {
    logger.warn(
      { externalId: input.externalId, action, error: error instanceof Error ? error.message : String(error) },
      "reminder disposition helper failed"
    );
  }
}

async function runDispositionCommand(command: { command: string; args: string[] }): Promise<void> {
  await execFileAsync(command.command, command.args, {
    cwd: process.cwd(),
    timeout: 15000,
    maxBuffer: 1024 * 128
  });
}
