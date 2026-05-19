import fs from "node:fs";
import { describe, expect, it } from "vitest";

const packageSource = "apps/reminder-watcher-swift/Package.swift";
const reminderCtlSource = "apps/reminder-watcher-swift/Sources/ReminderCtl/main.swift";

describe("Swift reminderctl helper", () => {
  it("exposes an npm command for building the Swift Reminders helper", () => {
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

    expect(packageJson.scripts["reminders:build"]).toBe("swift build --package-path apps/reminder-watcher-swift");
  });

  it("declares a reminderctl executable target in the Swift package", () => {
    const source = fs.readFileSync(packageSource, "utf8");

    expect(source).toContain('.executable(name: "reminderctl"');
    expect(source).toContain('.executableTarget(name: "ReminderCtl"');
    expect(source).toContain("__info_plist");
  });

  it("supports list, complete, delete, rename, and create command flags", () => {
    const source = fs.readFileSync(reminderCtlSource, "utf8");

    expect(source).toContain('case "list"');
    expect(source).toContain('case "complete"');
    expect(source).toContain('case "delete"');
    expect(source).toContain('case "rename"');
    expect(source).toContain('case "create"');
    expect(source).toContain("--list-names");
    expect(source).toContain("--external-id");
    expect(source).toContain("--list-name");
    expect(source).toContain("--title");
  });
});
