import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  REMINDERS_HELPER_TIMEOUT_MS,
  buildReminderDispositionCommand,
  buildReadReminderArgs,
  buildReadReminderCommand
} from "../src/reminders/helper.js";

describe("doctor reminders helper", () => {
  it("checks every configured reminder list", () => {
    expect(buildReadReminderArgs("./scripts/read-reminders.applescript", [
      "Walmart",
      "Walmart shopping",
      "Walmart shopping list"
    ])).toEqual([
      "./scripts/read-reminders.applescript",
      "Walmart",
      "Walmart shopping",
      "Walmart shopping list"
    ]);
  });

  it("allows slower Apple Reminders reads on first run", () => {
    expect(REMINDERS_HELPER_TIMEOUT_MS).toBeGreaterThanOrEqual(90_000);
  });

  it("prefers built Swift reminderctl for reminder reads when available", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "walmart-reminderctl-"));
    const helperPath = path.join(projectRoot, "apps/reminder-watcher-swift/.build/debug/reminderctl");
    fs.mkdirSync(path.dirname(helperPath), { recursive: true });
    fs.writeFileSync(helperPath, "#!/bin/sh\n", "utf8");

    expect(buildReadReminderCommand(projectRoot, ["Walmart", "Walmart shopping"])).toEqual({
      command: helperPath,
      args: ["list", "--list-names", "Walmart", "Walmart shopping"],
      format: "jsonl"
    });
  });

  it("falls back to AppleScript reminder reads when Swift reminderctl is not built", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "walmart-reminderctl-missing-"));

    expect(buildReadReminderCommand(projectRoot, ["Walmart"])).toEqual({
      command: "osascript",
      args: ["./scripts/read-reminders.applescript", "Walmart"],
      format: "tsv"
    });
  });

  it("builds reminder disposition commands with the same Swift preference", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "walmart-reminderctl-action-"));
    const helperPath = path.join(projectRoot, "apps/reminder-watcher-swift/.build/debug/reminderctl");
    fs.mkdirSync(path.dirname(helperPath), { recursive: true });
    fs.writeFileSync(helperPath, "#!/bin/sh\n", "utf8");

    expect(buildReminderDispositionCommand(projectRoot, "complete", "r1")).toEqual({
      command: helperPath,
      args: ["complete", "--external-id", "r1"]
    });
  });
});
