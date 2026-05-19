import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig, resolveProjectPath } from "../src/config/config.js";
import { createDatabase } from "../src/db/database.js";
import { REMINDERS_HELPER_TIMEOUT_MS, buildReminderHelperArgs } from "../src/doctor/reminders.js";
import { buildDashboardUrls, detectBonjourHost, pickLanAddress } from "../src/network/urls.js";

type Check = {
  name: string;
  ok: boolean;
  detail: string;
};

const checks: Check[] = [];
const config = loadConfig();

checks.push({
  name: "Node version",
  ok: Number(process.versions.node.split(".")[0]) >= 20,
  detail: process.version
});

const configPath = process.env.WALMART_REMINDERS_CONFIG ?? "config.yaml";
checks.push({
  name: "config.yaml",
  ok: fs.existsSync(configPath) || fs.existsSync("config.example.yaml"),
  detail: fs.existsSync(configPath) ? `${configPath} exists` : "config.yaml missing; config.example.yaml is available"
});

const dbPath = resolveProjectPath(config.database.path);
try {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = createDatabase(dbPath);
  db.raw.prepare("select 1").get();
  db.raw.close();
  checks.push({ name: "SQLite path", ok: true, detail: dbPath });
} catch (error) {
  checks.push({ name: "SQLite path", ok: false, detail: messageOf(error) });
}

try {
  execFileSync("osascript", buildReminderHelperArgs("./scripts/read-reminders.applescript", config.reminders.listNames), {
    cwd: process.cwd(),
    timeout: REMINDERS_HELPER_TIMEOUT_MS,
    maxBuffer: 1024 * 256
  });
  checks.push({ name: "Reminders helper", ok: true, detail: `AppleScript helper ran for ${config.reminders.listNames.join(", ")}` });
} catch (error) {
  checks.push({
    name: "Reminders helper",
    ok: false,
    detail: `${messageOf(error)} (grant Reminders access to Terminal/Node if prompted)`
  });
}

const profileDir = resolveProjectPath(config.walmart.profileDir);
try {
  fs.mkdirSync(profileDir, { recursive: true });
  checks.push({ name: "Walmart profile dir", ok: true, detail: profileDir });
} catch (error) {
  checks.push({ name: "Walmart profile dir", ok: false, detail: messageOf(error) });
}

const dashboardUrl = `http://127.0.0.1:${config.dashboard.port}/api/health`;
try {
  const response = await fetch(dashboardUrl, { signal: AbortSignal.timeout(2000) });
  checks.push({ name: "Dashboard reachable", ok: response.ok, detail: dashboardUrl });
} catch (error) {
  checks.push({ name: "Dashboard reachable", ok: false, detail: `${dashboardUrl} is not responding (${messageOf(error)})` });
}

const lanAddress = pickLanAddress();
const bonjourHost = detectBonjourHost("mac-mini.local");
const urls = buildDashboardUrls({
  port: config.dashboard.port,
  lanAddress,
  bonjourHost,
  httpsPort: config.dashboard.https.enabled ? config.dashboard.https.port : null
});
checks.push({
  name: "LAN URL detected",
  ok: Boolean(urls.lan),
  detail: urls.lan ?? "No 192.168.x.x / 10.x.x.x / 172.16-31.x.x address found"
});

for (const check of checks) {
  console.log(`${check.ok ? "OK" : "WARN"} ${check.name}: ${check.detail}`);
}
console.log("");
console.log(`Local Mac URL: ${urls.local}`);
console.log(`iPhone LAN URL: ${urls.lan ?? "unavailable"}`);
console.log(`mac-mini.local URL: ${urls.bonjour ?? "unavailable"}`);
if (urls.https) console.log(`HTTPS PWA URL: ${urls.https}`);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
