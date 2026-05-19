import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchAgentLabel, renderLaunchAgentPlist } from "../src/launchd/plist.js";

const projectDir = process.cwd();
const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
const plistPath = path.join(launchAgentsDir, `${launchAgentLabel}.plist`);

fs.mkdirSync(launchAgentsDir, { recursive: true });
fs.mkdirSync(path.join(projectDir, "var", "logs"), { recursive: true });
fs.writeFileSync(plistPath, renderLaunchAgentPlist(projectDir), "utf8");

console.log(`Wrote ${plistPath}`);
console.log("");
console.log("Install or reload with:");
console.log(`launchctl bootout gui/$UID ${plistPath} 2>/dev/null || true`);
console.log(`launchctl bootstrap gui/$UID ${plistPath}`);
console.log(`launchctl kickstart -k gui/$UID/${launchAgentLabel}`);
