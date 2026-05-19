import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";

const configSchema = z.object({
  reminders: z.object({
    listNames: z.array(z.string()).min(1).default(["Walmart", "Walmart shopping", "Walmart shopping list"]),
    fulfillAction: z.enum(["complete", "delete"]).default("complete"),
    deleteAction: z.enum(["complete", "delete"]).default("complete"),
    pollSeconds: z.number().int().positive().default(60)
  }),
  dashboard: z.object({
    host: z.string().default("0.0.0.0"),
    port: z.number().int().positive().default(3789),
    pin: z.string().nullable().default(null),
    https: z
      .object({
        enabled: z.boolean().default(false),
        port: z.number().int().positive().default(3790),
        certPath: z.string().default("./var/certs/cert.pem"),
        keyPath: z.string().default("./var/certs/key.pem")
      })
      .default({ enabled: false, port: 3790, certPath: "./var/certs/cert.pem", keyPath: "./var/certs/key.pem" })
  }),
  walmart: z.object({
    profileDir: z.string().default("./var/walmart-profile"),
    mode: z.enum(["manual", "auto_previous_only", "trusted_only"]).default("auto_previous_only"),
    catalogSyncMinutes: z.number().positive().default(60),
    orderSyncMinutes: z.number().positive().default(60),
    autoAddThreshold: z.number().min(0).max(1).default(0.92),
    proposeThreshold: z.number().min(0).max(1).default(0.45)
  }),
  database: z.object({
    path: z.string().default("./var/app.sqlite")
  })
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(configPath = process.env.WALMART_REMINDERS_CONFIG ?? "config.yaml"): AppConfig {
  const fallback = {
    reminders: {
      listNames: ["Walmart", "Walmart shopping", "Walmart shopping list"],
      fulfillAction: "complete",
      deleteAction: "complete",
      pollSeconds: 60
    },
    dashboard: {
      host: "0.0.0.0",
      port: 3789,
      pin: null,
      https: { enabled: false, port: 3790, certPath: "./var/certs/cert.pem", keyPath: "./var/certs/key.pem" }
    },
    walmart: {
      profileDir: "./var/walmart-profile",
      mode: "auto_previous_only",
      catalogSyncMinutes: 60,
      orderSyncMinutes: 60,
      autoAddThreshold: 0.92,
      proposeThreshold: 0.45
    },
    database: { path: "./var/app.sqlite" }
  };

  if (!fs.existsSync(configPath)) return configSchema.parse(fallback);
  const parsed = YAML.parse(fs.readFileSync(configPath, "utf8"));
  return configSchema.parse(parsed);
}

export function resolveProjectPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}
