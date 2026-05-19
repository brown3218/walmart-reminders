import { describe, expect, it } from "vitest";
import { REMINDERS_HELPER_TIMEOUT_MS, buildReminderHelperArgs } from "../src/doctor/reminders.js";

describe("doctor reminders helper", () => {
  it("checks every configured reminder list", () => {
    expect(buildReminderHelperArgs("./scripts/read-reminders.applescript", [
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
    expect(REMINDERS_HELPER_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
  });
});
