import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { renderLaunchAgentPlist } from "../src/launchd/plist.js";

describe("LaunchAgent plist rendering", () => {
  it("renders paths from the selected checkout instead of a hardcoded home path", () => {
    const plist = renderLaunchAgentPlist("/tmp/walmart-reminders");

    expect(plist).toContain("<string>/tmp/walmart-reminders</string>");
    expect(plist).toContain("<string>/tmp/walmart-reminders/scripts/run-service.sh</string>");
    expect(plist).toContain("<string>/tmp/walmart-reminders/var/logs/launchd.out.log</string>");
    expect(plist).not.toContain("/Users/davidbrown/Walmart");
  });

  it("escapes XML-sensitive characters in checkout paths", () => {
    const plist = renderLaunchAgentPlist("/tmp/Walmart & Reminders");

    expect(plist).toContain("/tmp/Walmart &amp; Reminders");
  });

  it("lets the service script discover npm from PATH for Apple Silicon or Intel installs", () => {
    const script = fs.readFileSync("scripts/run-service.sh", "utf8");

    expect(script).toContain('if [ -z "${NPM_BIN:-}" ]; then');
    expect(script).toContain('NPM_BIN="$(command -v npm)"');
    expect(script).not.toContain('NPM_BIN="${NPM_BIN:-/usr/local/bin/npm}"');
  });
});
