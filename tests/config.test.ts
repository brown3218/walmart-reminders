import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/config.js";

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
});
