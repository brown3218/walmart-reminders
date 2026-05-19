import fs from "node:fs";
import path from "node:path";

export const REMINDERS_HELPER_TIMEOUT_MS = 90_000;

export type ReminderReadCommand = {
  command: string;
  args: string[];
  format: "jsonl" | "tsv";
};

export type ReminderDispositionAction = "complete" | "delete";

export type ReminderDispositionCommand = {
  command: string;
  args: string[];
};

export function buildReadReminderArgs(scriptPath: string, listNames: string[]): string[] {
  return [scriptPath, ...listNames];
}

export function buildReadReminderCommand(projectRoot: string, listNames: string[]): ReminderReadCommand {
  const reminderCtlPath = builtReminderCtlPath(projectRoot);
  if (reminderCtlPath) {
    return {
      command: reminderCtlPath,
      args: ["list", "--list-names", ...listNames],
      format: "jsonl"
    };
  }

  return buildAppleScriptReadReminderCommand(listNames);
}

export function buildAppleScriptReadReminderCommand(listNames: string[]): ReminderReadCommand {
  return {
    command: "osascript",
    args: buildReadReminderArgs("./scripts/read-reminders.applescript", listNames),
    format: "tsv"
  };
}

export function buildReminderDispositionCommand(
  projectRoot: string,
  action: ReminderDispositionAction,
  externalId: string
): ReminderDispositionCommand {
  const reminderCtlPath = builtReminderCtlPath(projectRoot);
  if (reminderCtlPath) {
    return {
      command: reminderCtlPath,
      args: [action, "--external-id", externalId]
    };
  }

  return buildAppleScriptReminderDispositionCommand(action, externalId);
}

export function buildAppleScriptReminderDispositionCommand(
  action: ReminderDispositionAction,
  externalId: string
): ReminderDispositionCommand {
  return {
    command: "osascript",
    args: ["./scripts/reminderctl.applescript", action, externalId]
  };
}

function builtReminderCtlPath(projectRoot: string): string | null {
  const helperPath = path.join(projectRoot, "apps/reminder-watcher-swift/.build/debug/reminderctl");
  return fs.existsSync(helperPath) ? helperPath : null;
}
