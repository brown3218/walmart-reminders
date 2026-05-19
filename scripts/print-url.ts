import { loadConfig } from "../src/config/config.js";
import { buildDashboardUrls, detectBonjourHost, pickLanAddress } from "../src/network/urls.js";

const config = loadConfig();
const lanAddress = pickLanAddress();
const bonjourHost = detectBonjourHost("mac-mini.local");
const urls = buildDashboardUrls({
  port: config.dashboard.port,
  lanAddress,
  bonjourHost,
  httpsPort: config.dashboard.https.enabled ? config.dashboard.https.port : null
});

console.log("Walmart Reminders URLs");
console.log(`Local Mac: ${urls.local}`);
console.log(`iPhone LAN: ${urls.lan ?? "No private LAN IPv4 address detected"}`);
console.log(`mac-mini.local: ${urls.bonjour ?? "Not resolvable on this Mac right now"}`);
if (urls.https) {
  console.log(`HTTPS PWA: ${urls.https}`);
} else {
  console.log("HTTPS PWA: disabled (HTTP mode still works for Safari bookmarking)");
}
