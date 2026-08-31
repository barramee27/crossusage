(function () {
  const CREDITS_URL = "https://openrouter.ai/api/v1/credits";
  const KEY_URL = "https://openrouter.ai/api/v1/key";
  const CONFIG_PATHS = [
    "~/.config/openusage/openrouter.json",
    "~/.config/openrouter/key.json",
  ];
  const ENV_NAMES = ["OPENROUTER_API_KEY", "OPENROUTER_KEY"];

  function readString(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
  }

  function readNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function loadApiKeyFromConfig(ctx) {
    for (let i = 0; i < CONFIG_PATHS.length; i++) {
      const path = CONFIG_PATHS[i];
      try {
        if (!ctx.host.fs.exists(path)) continue;
        const text = ctx.host.fs.readText(path);
        if (!text) continue;
        const trimmed = text.trim();
        if (!trimmed) continue;
        if (trimmed.charAt(0) === "{") {
          const parsed = ctx.util.tryParseJson(trimmed);
          if (parsed && typeof parsed === "object") {
            const key =
              readString(parsed.apiKey) ||
              readString(parsed.api_key) ||
              readString(parsed.key);
            if (key) return key;
          }
        } else {
          return trimmed;
        }
      } catch (e) {
        ctx.host.log.warn("config read failed for " + path + ": " + String(e));
      }
    }
    return null;
  }

  function loadApiKeyFromEnv(ctx) {
    for (let i = 0; i < ENV_NAMES.length; i++) {
      const name = ENV_NAMES[i];
      let value = null;
      try {
        value = ctx.host.env.get(name);
      } catch (e) {
        ctx.host.log.warn("env read failed for " + name + ": " + String(e));
      }
      const key = readString(value);
      if (key) return key;
    }
    return null;
  }

  function loadApiKey(ctx) {
    const providerKey = ctx.util.providerApiKey && ctx.util.providerApiKey()
    if (providerKey) {
      ctx.host.log.info("api key loaded from provider account")
      return providerKey
    }
    return loadApiKeyFromConfig(ctx) || loadApiKeyFromEnv(ctx);
  }

  function requestJson(ctx, url, apiKey) {
    return ctx.util.request({
      method: "GET",
      url: url,
      headers: {
        Authorization: "Bearer " + apiKey,
        Accept: "application/json",
      },
      timeoutMs: 15000,
    });
  }

  function dataObject(ctx, resp) {
    if (!resp || resp.status < 200 || resp.status >= 300) return null;
    const json = ctx.util.tryParseJson(resp.bodyText);
    if (!json || typeof json !== "object") return null;
    const data = json.data;
    return data && typeof data === "object" ? data : null;
  }

  function creditsLines(ctx, data) {
    const totalUsage = readNumber(data.total_usage);
    if (totalUsage === null) return [];
    const used = Math.max(0, totalUsage);
    const totalCredits = Math.max(0, readNumber(data.total_credits) || 0);
    const lines = [];
    if (totalCredits > 0) {
      lines.push(
        ctx.line.progress({
          label: "Credits",
          used: used,
          limit: totalCredits,
          format: { kind: "dollars" },
        }),
      );
    }
    lines.push(
      ctx.line.text({
        label: "Balance",
        value: "$" + String(ctx.fmt.dollars(Math.max(0, totalCredits - used))),
      }),
    );
    return lines;
  }

  function appendSpend(ctx, value, label, lines) {
    const amount = readNumber(value);
    if (amount === null) return;
    lines.push(
      ctx.line.text({
        label: label,
        value: "$" + String(ctx.fmt.dollars(Math.max(0, amount))),
      }),
    );
  }

  function keyMetrics(ctx, data) {
    const lines = [];
    appendSpend(ctx, data.usage_daily, "Today", lines);
    appendSpend(ctx, data.usage_weekly, "This Week", lines);
    appendSpend(ctx, data.usage_monthly, "This Month", lines);
    const limit = readNumber(data.limit);
    if (limit !== null && limit > 0) {
      const remaining = Math.max(0, readNumber(data.limit_remaining) || 0);
      lines.push(
        ctx.line.progress({
          label: "Key Limit",
          used: Math.max(0, limit - remaining),
          limit: limit,
          format: { kind: "dollars" },
        }),
      );
    }
    let plan = null;
    if (typeof data.is_free_tier === "boolean") {
      plan = data.is_free_tier ? "Free tier" : "Pay as you go";
    }
    return { plan: plan, lines: lines };
  }

  function probe(ctx) {
    const apiKey = loadApiKey(ctx);
    if (!apiKey) {
      throw "No OpenRouter API key. Set OPENROUTER_API_KEY or add ~/.config/openusage/openrouter.json.";
    }

    let creditsResp = null;
    let keyResp = null;
    try {
      creditsResp = requestJson(ctx, CREDITS_URL, apiKey);
    } catch (e) {
      ctx.host.log.warn("credits request failed: " + String(e));
    }
    try {
      keyResp = requestJson(ctx, KEY_URL, apiKey);
    } catch (e) {
      ctx.host.log.warn("key request failed: " + String(e));
    }

    const creditsAuthFail =
      creditsResp && ctx.util.isAuthStatus(creditsResp.status);
    const keyAuthFail = keyResp && ctx.util.isAuthStatus(keyResp.status);
    if (creditsAuthFail && keyAuthFail) {
      throw "OpenRouter API key invalid. Check your key at openrouter.ai/keys.";
    }

    const lines = [];
    let plan = null;

    const creditsData = creditsResp ? dataObject(ctx, creditsResp) : null;
    if (creditsData) {
      lines.push.apply(lines, creditsLines(ctx, creditsData));
    }

    const keyData = keyResp ? dataObject(ctx, keyResp) : null;
    if (keyData) {
      const mapped = keyMetrics(ctx, keyData);
      if (mapped.plan) plan = mapped.plan;
      lines.push.apply(lines, mapped.lines);
    }

    if (lines.length === 0) {
      throw "OpenRouter usage data unavailable. Try again later.";
    }

    return { plan: plan, lines: lines };
  }

  globalThis.__openusage_plugin = { id: "openrouter", probe };
})();
