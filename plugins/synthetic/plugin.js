(function () {
  var API_URL = "https://api.synthetic.new/v2/quotas";
  var ONE_HOUR_MS = 60 * 60 * 1000;

  var CROSSUSAGE_CONFIG_PATH = "~/.crossusage/config.json";
  var DEFAULT_PI_AGENT_DIR = "~/.pi/agent";
  var FACTORY_SETTINGS_PATH = "~/.factory/settings.json";
  var OPENCODE_AUTH_PATH = "~/.local/share/opencode/auth.json";

  // Provider names a user might register Synthetic under in various harnesses
  var PROVIDER_NAMES = ["synthetic", "synthetic.new", "syn"];

  function resolvePiAgentDir(ctx) {
    var envDir = ctx.host.env.get("PI_CODING_AGENT_DIR");
    if (typeof envDir === "string" && envDir.trim()) {
      return envDir.trim();
    }
    return DEFAULT_PI_AGENT_DIR;
  }

  function extractKey(value) {
    if (typeof value === "string" && value.trim()) return value.trim();
    return null;
  }

  // Search a parsed JSON object for a Synthetic API key under known provider names
  function findKeyInProviderMap(obj) {
    if (!obj || typeof obj !== "object") return null;
    for (var i = 0; i < PROVIDER_NAMES.length; i++) {
      var entry = obj[PROVIDER_NAMES[i]];
      if (!entry) continue;
      // Pi auth.json style: { "synthetic": { "type": "api_key", "key": "syn_..." } }
      var k = extractKey(entry.key);
      if (k) return k;
      // Pi models.json style: { "providers": { "synthetic": { "apiKey": "syn_..." } } }
      k = extractKey(entry.apiKey);
      if (k) return k;
    }
    return null;
  }

  function tryReadJson(ctx, path) {
    try {
      if (!ctx.host.fs.exists(path)) return null;
      return ctx.util.tryParseJson(ctx.host.fs.readText(path));
    } catch (e) {
      ctx.host.log.warn("Failed to read " + path + ": " + e);
      return null;
    }
  }

  function toFiniteNumber(v) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      var n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  /** API may nest the payload under `data`. */
  function unwrapQuotasJson(raw) {
    if (!raw || typeof raw !== "object") return raw;
    if (raw.data && typeof raw.data === "object") {
      return Object.assign({}, raw.data, raw);
    }
    return raw;
  }

  function pickRollingFiveHour(json) {
    return json.rollingFiveHourLimit || json.rolling_five_hour_limit || null;
  }

  function pickWeeklyToken(json) {
    return json.weeklyTokenLimit || json.weekly_token_limit || null;
  }

  function pickFreeToolCalls(json) {
    return json.freeToolCalls || json.free_tool_calls || null;
  }

  function hasUsableRollingFiveHourLimit(value) {
    if (!value || typeof value !== "object") return false;
    var max = toFiniteNumber(value.max);
    var remaining = toFiniteNumber(value.remaining);
    return max !== null && remaining !== null;
  }

  function hasUsableWeeklyTokenLimit(value) {
    if (!value || typeof value !== "object") return false;
    return toFiniteNumber(value.percentRemaining) !== null;
  }

  function normalizeApiErrorMessage(json, status) {
    var fallback = "Request failed (HTTP " + status + ")";
    if (!json || typeof json !== "object") return fallback;

    var direct = typeof json.error === "string" ? json.error.trim() : "";
    if (direct) return direct;

    if (json.error && typeof json.error === "object") {
      var nested = typeof json.error.message === "string" ? json.error.message.trim() : "";
      if (nested) return nested;

      var serialized = JSON.stringify(json.error);
      if (serialized && serialized !== "{}") return serialized;
    }

    var message = typeof json.message === "string" ? json.message.trim() : "";
    if (message) return message;

    return fallback;
  }

  function loadApiKey(ctx) {
    // 0. CrossUsage user config (created on first app launch)
    var cu = tryReadJson(ctx, CROSSUSAGE_CONFIG_PATH);
    var sk;
    if (cu && cu.synthetic && typeof cu.synthetic === "object") {
      sk = extractKey(cu.synthetic.apiKey);
      if (sk) return sk;
    }
    if (cu && typeof cu.syntheticApiKey === "string") {
      sk = extractKey(cu.syntheticApiKey);
      if (sk) return sk;
    }

    var piDir = resolvePiAgentDir(ctx);

    // 1. Pi auth.json — primary source
    var piAuth = tryReadJson(ctx, piDir + "/auth.json");
    var key = findKeyInProviderMap(piAuth);
    if (key) return key;

    // 2. Pi models.json — custom provider config with apiKey field
    var piModels = tryReadJson(ctx, piDir + "/models.json");
    if (piModels && piModels.providers) {
      key = findKeyInProviderMap(piModels.providers);
      if (key) return key;
    }

    // 3. Factory/Droid settings.json — custom models with synthetic.new baseUrl
    var factorySettings = tryReadJson(ctx, FACTORY_SETTINGS_PATH);
    if (factorySettings && Array.isArray(factorySettings.customModels)) {
      for (var i = 0; i < factorySettings.customModels.length; i++) {
        var model = factorySettings.customModels[i];
        if (
          model &&
          typeof model.baseUrl === "string" &&
          model.baseUrl.indexOf("synthetic.new") !== -1
        ) {
          key = extractKey(model.apiKey);
          if (key) return key;
        }
      }
    }

    // 4. OpenCode auth.json
    var ocAuth = tryReadJson(ctx, OPENCODE_AUTH_PATH);
    key = findKeyInProviderMap(ocAuth);
    if (key) return key;

    // 5. SYNTHETIC_API_KEY env var
    var envKey = ctx.host.env.get("SYNTHETIC_API_KEY");
    if (typeof envKey === "string" && envKey.trim()) {
      return envKey.trim();
    }

    return null;
  }

  function probe(ctx) {
    var apiKey = loadApiKey(ctx);
    if (!apiKey) {
      throw "Synthetic API key not found. Put your syn_ key in ~/.crossusage/config.json under synthetic.apiKey, set SYNTHETIC_API_KEY, or configure Pi / Factory / OpenCode.";
    }

    var resp, json;
    try {
      var result = ctx.util.requestJson({
        method: "GET",
        url: API_URL,
        headers: {
          Authorization: "Bearer " + apiKey,
          Accept: "application/json",
        },
        timeoutMs: 15000,
      });
      resp = result.resp;
      json = result.json;
    } catch (e) {
      throw "Request failed. Check your connection.";
    }

    if (ctx.util.isAuthStatus(resp.status)) {
      throw "API key invalid or expired. Check your Synthetic API key.";
    }

    if (resp.status < 200 || resp.status >= 300) {
      var msg = normalizeApiErrorMessage(json, resp.status);
      throw msg;
    }

    if (!json) {
      throw "Could not parse usage data.";
    }

    json = unwrapQuotasJson(json);

    var rfl = pickRollingFiveHour(json);
    var wtl = pickWeeklyToken(json);

    var lines = [];

    // 5h Rate Limit — hero metric (immediate blocker)
    if (hasUsableRollingFiveHourLimit(rfl)) {
      var rflMax = toFiniteNumber(rfl.max);
      var rflRem = toFiniteNumber(rfl.remaining);
      var rflUsed = Math.max(0, rflMax - rflRem);
      lines.push(ctx.line.progress({
        label: "5h Rate Limit",
        used: rflUsed,
        limit: rflMax,
        format: { kind: "count", suffix: "requests" },
      }));
    }

    // Mana Bar — longer-term weekly budget
    if (hasUsableWeeklyTokenLimit(wtl)) {
      var pct = toFiniteNumber(wtl.percentRemaining);
      var manaUsed = Math.max(0, Math.round(100 - pct));
      lines.push(ctx.line.progress({
        label: "Mana Bar",
        used: manaUsed,
        limit: 100,
        format: { kind: "percent" },
      }));
    }

    // Rate Limited badge — only when actively limited
    if (rfl && rfl.limited === true) {
      lines.push(
        ctx.line.badge({
          label: "Rate Limited",
          text: "Rate limited",
          color: "#ef4444",
        })
      );
    }

    // Subscription — legacy request count, only shown if NOT on v3 rate limits
    var onV3 = hasUsableRollingFiveHourLimit(rfl) || hasUsableWeeklyTokenLimit(wtl);
    if (!onV3 && json.subscription) {
      var sub = json.subscription;
      var subLimit = toFiniteNumber(sub.limit);
      if (subLimit !== null) {
        var subReq = toFiniteNumber(sub.requests);
        if (subReq === null) subReq = 0;
        var subOpts = {
          label: "Subscription",
          used: subReq,
          limit: subLimit,
          format: { kind: "count", suffix: "requests" },
        };
        var subReset = ctx.util.toIso(sub.renewsAt);
        if (subReset) subOpts.resetsAt = subReset;
        lines.push(ctx.line.progress(subOpts));
      }
    }

    // Free Tool Calls — legacy only, zeroed out on v3
    var ftc = pickFreeToolCalls(json);
    if (!onV3 && ftc) {
      var ftcLimit = toFiniteNumber(ftc.limit);
      if (ftcLimit !== null && ftcLimit > 0) {
        var ftcReq = toFiniteNumber(ftc.requests);
        if (ftcReq === null) ftcReq = 0;
        var ftcOpts = {
          label: "Free Tool Calls",
          used: Math.round(ftcReq),
          limit: ftcLimit,
          format: { kind: "count", suffix: "requests" },
        };
        var ftcReset = ctx.util.toIso(ftc.renewsAt);
        if (ftcReset) ftcOpts.resetsAt = ftcReset;
        lines.push(ctx.line.progress(ftcOpts));
      }
    }

    // Search — hourly search quota (detail)
    if (json.search && json.search.hourly) {
      var srch = json.search.hourly;
      var srchLimit = toFiniteNumber(srch.limit);
      if (srchLimit !== null) {
        var srchReq = toFiniteNumber(srch.requests);
        if (srchReq === null) srchReq = 0;
        var srchOpts = {
          label: "Search",
          used: srchReq,
          limit: srchLimit,
          format: { kind: "count", suffix: "requests" },
          periodDurationMs: ONE_HOUR_MS,
        };
        var srchReset = ctx.util.toIso(srch.renewsAt);
        if (srchReset) srchOpts.resetsAt = srchReset;
        lines.push(ctx.line.progress(srchOpts));
      }
    }

    if (lines.length === 0) {
      var keys = Object.keys(json).filter(function (k) {
        return k !== "data";
      });
      ctx.host.log.warn(
        "Synthetic /v2/quotas: no quota rows matched; top-level keys: " + keys.join(", ")
      );
      lines.push(
        ctx.line.badge({
          label: "Quotas",
          text:
            "API OK — no fields matched (check Synthetic API changes or open a GitHub issue)",
          color: "#64748b",
        })
      );
    }

    return { lines: lines };
  }

  globalThis.__openusage_plugin = { id: "synthetic", probe: probe };
})();
