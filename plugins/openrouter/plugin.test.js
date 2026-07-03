import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePluginTestContext } from "../test-helpers.js";

const loadPlugin = async () => {
  await import("./plugin.js");
  return globalThis.__openusage_plugin;
};

function mockEnvKey(ctx, key) {
  ctx.host.env.get.mockImplementation((name) => {
    if (name === "OPENROUTER_API_KEY") return key;
    return null;
  });
}

describe("openrouter plugin", () => {
  beforeEach(() => {
    delete globalThis.__openusage_plugin;
    if (vi.resetModules) vi.resetModules();
  });

  it("throws when no API key is configured", async () => {
    const ctx = makePluginTestContext();
    const plugin = await loadPlugin();
    expect(() => plugin.probe(ctx)).toThrow("No OpenRouter API key");
  });

  it("maps credits and key endpoints independently", async () => {
    const ctx = makePluginTestContext();
    mockEnvKey(ctx, "sk-or-test");
    ctx.host.http.request.mockImplementation((req) => {
      if (req.url.includes("/credits")) {
        return {
          status: 200,
          bodyText: JSON.stringify({ data: { total_usage: 4.5, total_credits: 10 } }),
        };
      }
      if (req.url.includes("/key")) {
        return {
          status: 200,
          bodyText: JSON.stringify({
            data: {
              is_free_tier: false,
              usage_daily: 1.25,
              usage_weekly: 3.5,
              usage_monthly: 8,
              limit: 20,
              usage: 5,
            },
          }),
        };
      }
      return { status: 404, bodyText: "" };
    });

    const plugin = await loadPlugin();
    const result = plugin.probe(ctx);
    expect(result.plan).toBe("Pay as you go");
    expect(result.lines.find((l) => l.label === "Credits")).toBeTruthy();
    expect(result.lines.find((l) => l.label === "Balance")).toBeTruthy();
    expect(result.lines.find((l) => l.label === "Today")).toBeTruthy();
    expect(result.lines.find((l) => l.label === "Key Limit")).toBeTruthy();
  });

  it("throws invalid key only when both endpoints reject auth", async () => {
    const ctx = makePluginTestContext();
    mockEnvKey(ctx, "sk-or-bad");
    ctx.host.http.request.mockReturnValue({ status: 403, bodyText: "" });
    const plugin = await loadPlugin();
    expect(() => plugin.probe(ctx)).toThrow("OpenRouter API key invalid");
  });

  it("still returns key metrics when credits endpoint is forbidden", async () => {
    const ctx = makePluginTestContext();
    mockEnvKey(ctx, "sk-or-test");
    ctx.host.http.request.mockImplementation((req) => {
      if (req.url.includes("/credits")) return { status: 403, bodyText: "" };
      return {
        status: 200,
        bodyText: JSON.stringify({ data: { usage_daily: 0.5, is_free_tier: true } }),
      };
    });
    const plugin = await loadPlugin();
    const result = plugin.probe(ctx);
    expect(result.plan).toBe("Free tier");
    expect(result.lines.find((l) => l.label === "Today")).toBeTruthy();
  });
});
