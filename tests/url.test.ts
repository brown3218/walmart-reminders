import { describe, expect, it } from "vitest";
import { buildDashboardUrls, pickLanAddress } from "../src/network/urls.js";

describe("dashboard URL detection", () => {
  it("prefers private IPv4 addresses for the iPhone LAN URL", () => {
    const address = pickLanAddress({
      lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      en0: [{ address: "192.168.1.44", family: "IPv4", internal: false }],
      utun0: [{ address: "100.64.0.2", family: "IPv4", internal: false }]
    });

    expect(address).toBe("192.168.1.44");
  });

  it("prints local, LAN, and Bonjour URLs", () => {
    expect(buildDashboardUrls({ port: 3789, lanAddress: "10.0.0.22", bonjourHost: "mac-mini.local" })).toEqual({
      local: "http://localhost:3789",
      lan: "http://10.0.0.22:3789",
      bonjour: "http://mac-mini.local:3789"
    });
  });

  it("uses a Bonjour host for the HTTPS PWA URL when no LAN address is detected", () => {
    expect(buildDashboardUrls({ port: 3789, lanAddress: null, bonjourHost: "mac-mini.local", httpsPort: 3790 })).toEqual({
      local: "http://localhost:3789",
      lan: null,
      bonjour: "http://mac-mini.local:3789",
      https: "https://mac-mini.local:3790"
    });
  });
});
