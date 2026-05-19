import os from "node:os";
import { execFileSync } from "node:child_process";

type NetworkAddress = {
  address: string;
  family: string | number;
  internal: boolean;
};

export type DashboardUrls = {
  local: string;
  lan: string | null;
  bonjour: string | null;
  https?: string | null;
};

export function pickLanAddress(
  interfaces: NodeJS.Dict<NetworkAddress[]> = os.networkInterfaces() as NodeJS.Dict<NetworkAddress[]>
): string | null {
  const addresses = Object.values(interfaces)
    .flatMap((entries) => entries ?? [])
    .filter((entry) => !entry.internal && String(entry.family) === "IPv4")
    .map((entry) => entry.address);

  return (
    addresses.find((address) => /^192\.168\./.test(address)) ??
    addresses.find((address) => /^10\./.test(address)) ??
    addresses.find((address) => /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) ??
    null
  );
}

export function detectBonjourHost(host = "mac-mini.local"): string | null {
  try {
    execFileSync("dscacheutil", ["-q", "host", "-a", "name", host], { timeout: 1500, stdio: "ignore" });
    return host;
  } catch {
    return null;
  }
}

export function buildDashboardUrls(input: {
  port: number;
  lanAddress?: string | null;
  bonjourHost?: string | null;
  httpsPort?: number | null;
}): DashboardUrls {
  const urls: DashboardUrls = {
    local: `http://localhost:${input.port}`,
    lan: input.lanAddress ? `http://${input.lanAddress}:${input.port}` : null,
    bonjour: input.bonjourHost ? `http://${input.bonjourHost}:${input.port}` : null
  };
  if (input.httpsPort && input.lanAddress) urls.https = `https://${input.lanAddress}:${input.httpsPort}`;
  return urls;
}
