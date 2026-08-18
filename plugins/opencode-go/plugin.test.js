import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeCtx } from "../test-helpers.js";

const AUTH_PATH = "~/.local/share/opencode/auth.json";

const loadPlugin = async () => {
  await import("./plugin.js");
  return globalThis.__openusage_plugin;
};

function setAuth(ctx, value = "go-key") {
  ctx.host.fs.writeText(
    AUTH_PATH,
    JSON.stringify({
      "opencode-go": { type: "api-key", key: value },
    }),
  );
}

function setHistoryQuery(ctx, rows, options = {}) {
  const list = Array.isArray(rows) ? rows : [];
  ctx.host.sqlite.query.mockImplementation((dbPath, sql) => {
    expect(dbPath).toBe("~/.local/share/opencode/opencode.db");

    if (String(sql).includes("SELECT 1 AS present")) {
      if (options.assertFilters !== false) {
        expect(String(sql)).toContain(
          "json_extract(data, '$.providerID') = 'opencode-go'",
        );
        expect(String(sql)).toContain(
          "json_extract(data, '$.role') = 'assistant'",
        );
        expect(String(sql)).toContain(
          "json_type(data, '$.cost') IN ('integer', 'real')",
        );
      }
      return JSON.stringify(list.length > 0 ? [{ present: 1 }] : []);
    }

    if (options.assertFilters !== false) {
      expect(String(sql)).toContain(
        "json_extract(data, '$.providerID') = 'opencode-go'",
      );
      expect(String(sql)).toContain(
        "json_extract(data, '$.role') = 'assistant'",
      );
      expect(String(sql)).toContain(
        "json_type(data, '$.cost') IN ('integer', 'real')",
      );
      expect(String(sql)).toContain(
        "COALESCE(json_extract(data, '$.time.created'), time_created)",
      );
    }

    return JSON.stringify(list);
  });
}

function setUsageApi(ctx, { status = 200, body } = {}) {
  ctx.host.http.request.mockImplementation((opts) => {
    expect(opts.method).toBe("GET");
    expect(opts.url).toBe("https://opencode.ai/zen/go/v1/usage");
    expect(opts.headers.Authorization).toBe("Bearer go-key");
    return {
      status,
      bodyText: typeof body === "string" ? body : JSON.stringify(body),
    };
  });
}

const API_USAGE = {
  usage: {
    rolling: { percent: 12.5, resetsAt: "2026-03-06T17:00:00.000Z" },
    weekly: { percent: 40, resetsAt: "2026-03-09T00:00:00.000Z" },
    monthly: { percent: 8, resetsAt: "2026-04-01T00:00:00.000Z" },
  },
};

describe("opencode-go plugin", () => {
  beforeEach(() => {
    delete globalThis.__openusage_plugin;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("ships plugin metadata with links and expected line layout", () => {
    const manifest = JSON.parse(
      readFileSync("plugins/opencode-go/plugin.json", "utf8"),
    );

    expect(manifest.id).toBe("opencode-go");
    expect(manifest.name).toBe("OpenCode Go");
    expect(manifest.brandColor).toBe("#000000");
    expect(manifest.links).toEqual([
      { label: "Console", url: "https://opencode.ai/auth" },
      { label: "Docs", url: "https://opencode.ai/docs/go/" },
    ]);
    expect(manifest.lines).toEqual([
      { type: "progress", label: "Session", scope: "overview", primaryOrder: 1 },
      { type: "progress", label: "Weekly", scope: "overview" },
      { type: "progress", label: "Monthly", scope: "detail" },
    ]);
  });

  it("throws when neither auth nor local history is present", async () => {
    const ctx = makeCtx();
    setHistoryQuery(ctx, []);

    const plugin = await loadPlugin();
    expect(() => plugin.probe(ctx)).toThrow(
      "OpenCode Go not detected. Log in with OpenCode Go or use it locally first.",
    );
  });

  it("enables with auth only and uses the official usage API", async () => {
    const ctx = makeCtx();
    setAuth(ctx);
    setUsageApi(ctx, { body: API_USAGE });

    const plugin = await loadPlugin();
    const result = plugin.probe(ctx);

    expect(result.plan).toBe("Go");
    expect(result.lines.map((line) => line.label)).toEqual([
      "Session",
      "Weekly",
      "Monthly",
    ]);
    expect(result.lines[0].used).toBe(12.5);
    expect(result.lines[1].used).toBe(40);
    expect(result.lines[2].used).toBe(8);
    expect(result.lines[0].resetsAt).toBe("2026-03-06T17:00:00.000Z");
    expect(ctx.host.sqlite.query).not.toHaveBeenCalled();
  });

  it("enables with history only when auth is absent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T12:00:00.000Z"));

    const ctx = makeCtx();
    setHistoryQuery(ctx, [
      { createdMs: Date.parse("2026-03-06T11:00:00.000Z"), cost: 3 },
    ]);

    const plugin = await loadPlugin();
    const result = plugin.probe(ctx);

    expect(result.plan).toBe("Go");
    expect(result.lines[0].used).toBe(25);
  });

  it("uses row timestamp fallback when JSON timestamp is missing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T12:00:00.000Z"));

    const ctx = makeCtx();
    setHistoryQuery(ctx, [
      { createdMs: Date.parse("2026-03-06T09:30:00.000Z"), cost: 1.2 },
    ]);

    const plugin = await loadPlugin();
    const result = plugin.probe(ctx);

    expect(result.lines[0].used).toBe(10);
    expect(result.lines[0].resetsAt).toBe("2026-03-06T14:30:00.000Z");
  });

  it("counts only the rolling 5h window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T12:00:00.000Z"));

    const ctx = makeCtx();
    setHistoryQuery(ctx, [
      { createdMs: Date.parse("2026-03-06T06:30:00.000Z"), cost: 9 },
      { createdMs: Date.parse("2026-03-06T08:00:00.000Z"), cost: 2.4 },
      { createdMs: Date.parse("2026-03-06T10:00:00.000Z"), cost: 1.2 },
    ]);

    const plugin = await loadPlugin();
    const result = plugin.probe(ctx);

    expect(result.lines[0].used).toBe(30);
    expect(result.lines[0].resetsAt).toBe("2026-03-06T13:00:00.000Z");
  });

  it("uses UTC Monday boundaries for weekly aggregation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T12:00:00.000Z"));

    const ctx = makeCtx();
    setHistoryQuery(ctx, [
      { createdMs: Date.parse("2026-03-01T23:59:59.000Z"), cost: 10 },
      { createdMs: Date.parse("2026-03-02T00:00:00.000Z"), cost: 6 },
      { createdMs: Date.parse("2026-03-05T09:00:00.000Z"), cost: 3 },
    ]);

    const plugin = await loadPlugin();
    const result = plugin.probe(ctx);
    const weeklyLine = result.lines.find((line) => line.label === "Weekly");

    expect(weeklyLine.used).toBe(30);
    expect(weeklyLine.resetsAt).toBe("2026-03-09T00:00:00.000Z");
  });

  it("uses the earliest local usage timestamp as the monthly anchor", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T12:00:00.000Z"));

    const ctx = makeCtx();
    setHistoryQuery(ctx, [
      { createdMs: Date.parse("2026-02-25T07:53:16.000Z"), cost: 2.181 },
      { createdMs: Date.parse("2026-03-01T00:00:00.000Z"), cost: 0.2 },
      { createdMs: Date.parse("2026-03-04T12:00:00.000Z"), cost: 0.2904 },
    ]);

    const plugin = await loadPlugin();
    const result = plugin.probe(ctx);
    const monthlyLine = result.lines.find((line) => line.label === "Monthly");

    expect(monthlyLine.used).toBe(4.5);
    expect(monthlyLine.resetsAt).toBe("2026-03-25T07:53:16.000Z");
    expect(monthlyLine.periodDurationMs).toBe(28 * 24 * 60 * 60 * 1000);
  });

  it("clamps percentages at 100", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-06T12:00:00.000Z"));

    const ctx = makeCtx();
    setHistoryQuery(ctx, [
      { createdMs: Date.parse("2026-03-06T11:00:00.000Z"), cost: 40 },
    ]);

    const plugin = await loadPlugin();
    const result = plugin.probe(ctx);

    expect(result.lines[0].used).toBe(100);
  });

  it("throws when the Go key is rejected", async () => {
    const ctx = makeCtx();
    setAuth(ctx);
    setUsageApi(ctx, { status: 401, body: { error: { type: "AuthError" } } });

    const plugin = await loadPlugin();
    expect(() => plugin.probe(ctx)).toThrow(
      "OpenCode Go key was rejected. Log into OpenCode Go again.",
    );
  });

  it("throws when the key has no Go subscription", async () => {
    const ctx = makeCtx();
    setAuth(ctx);
    setUsageApi(ctx, { status: 403, body: { error: { type: "EntitlementError" } } });

    const plugin = await loadPlugin();
    expect(() => plugin.probe(ctx)).toThrow("No OpenCode Go subscription on this key.");
  });
});
