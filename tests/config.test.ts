import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatDashboardPinDoctorCheck, formatDeprecatedConfigDoctorCheck, loadConfig } from "../src/config/config.js";

describe("configuration", () => {
  it("uses catalogSyncMinutes as the Walmart catalog interval config", () => {
    const config = loadConfig(path.join(os.tmpdir(), "missing-walmart-config.yaml"));

    expect(config.walmart.catalogSyncMinutes).toBe(60);
    expect(config.walmart).not.toHaveProperty("reorderSyncHours");
  });

  it("keeps the example config free of deprecated reorder sync settings", () => {
    const example = fs.readFileSync("config.example.yaml", "utf8");

    expect(example).toContain("catalogSyncMinutes: 60");
    expect(example).not.toContain("reorderSyncHours");
  });

  it("warns when the dashboard PIN is missing or still the setup placeholder", () => {
    expect(formatDashboardPinDoctorCheck(null)).toEqual({
      ok: false,
      detail: "dashboard PIN is disabled; set dashboard.pin before using the LAN URL"
    });
    expect(formatDashboardPinDoctorCheck("change-me")).toEqual({
      ok: false,
      detail: "dashboard PIN is still change-me; set a private PIN before using the LAN URL"
    });
    expect(formatDashboardPinDoctorCheck("812846")).toEqual({
      ok: true,
      detail: "dashboard PIN is configured"
    });
  });

  it("warns when config still uses deprecated Walmart sync settings", () => {
    expect(
      formatDeprecatedConfigDoctorCheck(`
        walmart:
          reorderSyncHours: 12
      `)
    ).toEqual({
      ok: false,
      detail: "deprecated config key walmart.reorderSyncHours is ignored; use walmart.catalogSyncMinutes and walmart.orderSyncMinutes"
    });
    expect(
      formatDeprecatedConfigDoctorCheck(`
        walmart:
          catalogSyncMinutes: 60
          orderSyncMinutes: 60
      `)
    ).toEqual({
      ok: true,
      detail: "no deprecated config keys found"
    });
  });
});
