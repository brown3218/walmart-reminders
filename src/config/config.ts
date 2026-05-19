import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

const configSchema = z.object({
  reminders: z.object({
    listNames: z.array(z.string()).min(1).default(["Walmart", "Walmart shopping list"]),
    pollSeconds: z.number().int().positive().default(90)
  }),
  dashboard: z.object({
    host: z.string().default("127.0.0.1"),
    port: z.number().int().positive().default(3789),
    pin: z.string().nullable().default(null)
  }),
  walmart: z.object({
    profileDir: z.string().default("./var/walmart-profile"),
    mode: z.enum(["manual", "auto_previous_only", "trusted_only"]).default("auto_previous_only"),
    reorderSyncHours: z.number().positive().default(12)
  }),
  database: z.object({
    path: z.string().default("./var/app.sqlite")
  })
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(configPath = process.env.WALMART_REMINDERS_CONFIG ?? "config.yaml"): AppConfig {
  const fallback = {
    reminders: { listNames: ["Walmart", "Walmart shopping list"], pollSeconds: 90 },
    dashboard: { host: "127.0.0.1", port: 3789, pin: null },
    walmart: { profileDir: "./var/walmart-profile", mode: "auto_previous_only", reorderSyncHours: 12 },
    database: { path: "./var/app.sqlite" }
  };

  if (!fs.existsSync(configPath)) return configSchema.parse(fallback);
  const parsed = YAML.parse(fs.readFileSync(configPath, "utf8"));
  return configSchema.parse(parsed);
}

export function resolveProjectPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}
