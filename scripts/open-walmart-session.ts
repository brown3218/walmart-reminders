import { openPersistentWalmartSession } from "../src/walmart/reorderCatalog.js";
import { loadConfig, resolveProjectPath } from "../src/config/config.js";

const config = loadConfig();
const context = await openPersistentWalmartSession(resolveProjectPath(config.walmart.profileDir));
const page = context.pages()[0] ?? (await context.newPage());
await page.goto("https://www.walmart.com/my-items/reorder", { waitUntil: "domcontentloaded" });

console.log("Walmart persistent session is open. Log in or complete verification, then close the browser window.");
page.on("close", async () => {
  await context.close();
  process.exit(0);
});
