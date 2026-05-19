import { describe, expect, it } from "vitest";
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
});
