import { afterEach, describe, expect, it, vi } from "vitest";
import { startWalmartSyncJobs } from "../src/walmart/scheduler.js";

describe("Walmart sync scheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs catalog and order sync on startup and at configured intervals", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const handles = startWalmartSyncJobs({
      config: {
        walmart: {
          catalogSyncMinutes: 10,
          orderSyncMinutes: 20
        }
      } as never,
      logger: { warn: () => undefined, info: () => undefined } as never,
      runCatalog: async () => {
        calls.push("catalog");
      },
      runOrders: async () => {
        calls.push("orders");
      }
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["catalog", "orders"]);

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(calls).toEqual(["catalog", "orders", "catalog"]);

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(calls).toEqual(["catalog", "orders", "catalog", "catalog", "orders"]);

    for (const handle of handles) clearInterval(handle);
  });

  it("serializes scheduled jobs so the Walmart profile is opened by one job at a time", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let finishCatalog!: () => void;
    const catalogFinished = new Promise<void>((resolve) => {
      finishCatalog = resolve;
    });
    const handles = startWalmartSyncJobs({
      config: {
        walmart: {
          catalogSyncMinutes: 10,
          orderSyncMinutes: 20
        }
      } as never,
      logger: { warn: () => undefined, info: () => undefined } as never,
      runCatalog: async () => {
        calls.push("catalog-start");
        await catalogFinished;
        calls.push("catalog-end");
      },
      runOrders: async () => {
        calls.push("orders");
      }
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["catalog-start"]);

    finishCatalog();
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(["catalog-start", "catalog-end", "orders"]);

    for (const handle of handles) clearInterval(handle);
  });
});
