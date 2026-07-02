(function () {
  const KEYCHAIN_SERVICE = "OpenUsage-copilot";
  const GH_KEYCHAIN_SERVICE = "gh:github.com";
  const USAGE_URL = "https://api.github.com/copilot_internal/user";
  const PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

  function readJson(ctx, path) {
    try {
      if (!ctx.host.fs.exists(path)) return null;
      const text = ctx.host.fs.readText(path);
      return ctx.util.tryParseJson(text);
    } catch (e) {
      ctx.host.log.warn("readJson failed for " + path + ": " + String(e));
      return null;
    }
  }

  function writeJson(ctx, path, value) {
    try {
      ctx.host.fs.writeText(path, JSON.stringify(value));
    } catch (e) {
      ctx.host.log.warn("writeJson failed for " + path + ": " + String(e));
    }
  }

  function saveToken(ctx, token) {
    try {
      ctx.host.keychain.writeGenericPassword(
        KEYCHAIN_SERVICE,
        JSON.stringify({ token: token }),
      );
    } catch (e) {
      ctx.host.log.warn("keychain write failed: " + String(e));
    }
    writeJson(ctx, ctx.app.pluginDataDir + "/auth.json", { token: token });
  }

  function clearCachedToken(ctx) {
    try {
      ctx.host.keychain.deleteGenericPassword(KEYCHAIN_SERVICE);
    } catch (e) {
      ctx.host.log.info("keychain delete failed: " + String(e));
    }
    writeJson(ctx, ctx.app.pluginDataDir + "/auth.json", null);
  }

  function loadTokenFromKeychain(ctx) {
    try {
      const raw = ctx.host.keychain.readGenericPassword(KEYCHAIN_SERVICE);
      if (raw) {
        const parsed = ctx.util.tryParseJson(raw);
        if (parsed && parsed.token) {
          ctx.host.log.info("token loaded from OpenUsage keychain");
          return { token: parsed.token, source: "keychain" };
        }
      }
    } catch (e) {
      ctx.host.log.info("OpenUsage keychain read failed: " + String(e));
    }
    return null;
  }

  function loadTokenFromGhCli(ctx) {
    try {
      const raw = ctx.host.keychain.readGenericPassword(GH_KEYCHAIN_SERVICE);
      if (raw) {
        let token = raw;
        if (
          typeof token === "string" &&
          token.indexOf("go-keyring-base64:") === 0
        ) {
          token = ctx.base64.decode(token.slice("go-keyring-base64:".length));
        }
        if (token) {
          ctx.host.log.info("token loaded from gh CLI keychain");
          return { token: token, source: "gh-cli" };
        }
      }
    } catch (e) {
      ctx.host.log.info("gh CLI keychain read failed: " + String(e));
    }
    return null;
  }

  function loadTokenFromStateFile(ctx) {
    const data = readJson(ctx, ctx.app.pluginDataDir + "/auth.json");
    if (data && data.token) {
      ctx.host.log.info("token loaded from state file");
      return { token: data.token, source: "state" };
    }
    return null;
  }

  function loadToken(ctx) {
    return (
      loadTokenFromKeychain(ctx) ||
      loadTokenFromGhCli(ctx) ||
      loadTokenFromStateFile(ctx)
    );
  }

  function fetchUsage(ctx, token) {
    return ctx.util.request({
      method: "GET",
      url: USAGE_URL,
      headers: {
        Authorization: "token " + token,
        Accept: "application/json",
        "Editor-Version": "vscode/1.96.2",
        "Editor-Plugin-Version": "copilot-chat/0.26.7",
        "User-Agent": "GitHubCopilotChat/0.26.7",
        "X-Github-Api-Version": "2025-04-01",
      },
      timeoutMs: 10000,
    });
  }

  function readNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function readBool(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const v = value.trim().toLowerCase();
      if (v === "true" || v === "1") return true;
      if (v === "false" || v === "0") return false;
    }
    return null;
  }

  function clampPercent(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, value));
  }

  function snapshotLine(ctx, label, snapshot, resetDate) {
    if (!snapshot || typeof snapshot !== "object") return null;

    const entitlement = readNumber(snapshot.entitlement);
    const remaining = readNumber(snapshot.remaining);

    if (readBool(snapshot.unlimited) === true || entitlement === -1 || remaining === -1) {
      return null;
    }
    if (entitlement === 0) return null;

    let usedPercent = null;
    const percentRemaining = readNumber(snapshot.percent_remaining);
    if (percentRemaining !== null) {
      usedPercent = clampPercent(100 - percentRemaining);
    } else if (entitlement !== null && entitlement > 0 && remaining !== null) {
      usedPercent = clampPercent(100 - (remaining / entitlement) * 100);
    }
    if (usedPercent === null) return null;

    return ctx.line.progress({
      label: label,
      used: usedPercent,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: ctx.util.toIso(resetDate),
      periodDurationMs: PERIOD_MS,
    });
  }

  function overageLine(ctx, snapshot) {
    if (!snapshot || typeof snapshot !== "object") return null;
    if (readBool(snapshot.overage_permitted) !== true) return null;
    const overage = Math.max(0, readNumber(snapshot.overage_count) || 0);
    return ctx.line.text({
      label: "Extra Usage",
      value: String(Math.floor(overage)),
    });
  }

  function limitedLine(ctx, label, remaining, total, resetDate) {
    const totalNum = readNumber(total);
    const remainingNum = readNumber(remaining);
    if (totalNum === null || totalNum <= 0 || remainingNum === null) return null;
    const used = Math.max(0, totalNum - remainingNum);
    const usedPercent = clampPercent((used / totalNum) * 100);
    return ctx.line.progress({
      label: label,
      used: usedPercent,
      limit: 100,
      format: { kind: "percent" },
      resetsAt: ctx.util.toIso(resetDate),
      periodDurationMs: PERIOD_MS,
    });
  }

  function mapUsage(ctx, data) {
    const lines = [];
    const resetDate = data.quota_reset_date || data.limited_user_reset_date;
    const snapshots = data.quota_snapshots;

    if (snapshots && typeof snapshots === "object") {
      const premium = snapshots.premium_interactions;
      const creditsLine = snapshotLine(ctx, "Credits", premium, resetDate);
      if (creditsLine) lines.push(creditsLine);
      const extraLine = overageLine(ctx, premium);
      if (extraLine) lines.push(extraLine);

      const chatLine = snapshotLine(ctx, "Chat", snapshots.chat, resetDate);
      if (chatLine) lines.push(chatLine);
      const completionsLine = snapshotLine(ctx, "Completions", snapshots.completions, resetDate);
      if (completionsLine) lines.push(completionsLine);
    }

    if (lines.length === 0 && data.limited_user_quotas && data.monthly_quotas) {
      const lq = data.limited_user_quotas;
      const mq = data.monthly_quotas;
      const reset = data.limited_user_reset_date;
      const chatLine = limitedLine(ctx, "Chat", lq.chat, mq.chat, reset);
      if (chatLine) lines.push(chatLine);
      const completionsLine = limitedLine(ctx, "Completions", lq.completions, mq.completions, reset);
      if (completionsLine) lines.push(completionsLine);
    }

    if (lines.length === 0) {
      if (readBool(data.token_based_billing) === true) {
        return { lines: [], tokenBasedBilling: true };
      }
      throw "Copilot usage data is unavailable for this account.";
    }

    return { lines: lines };
  }

  function probe(ctx) {
    const cred = loadToken(ctx);
    if (!cred) {
      throw "Not logged in. Run `gh auth login` first.";
    }

    let token = cred.token;
    let source = cred.source;

    let resp;
    try {
      resp = fetchUsage(ctx, token);
    } catch (e) {
      ctx.host.log.error("usage request exception: " + String(e));
      throw "Usage request failed. Check your connection.";
    }

    if (resp.status === 401 || resp.status === 403) {
      if (source === "keychain") {
        ctx.host.log.info("cached token invalid, trying fallback sources");
        clearCachedToken(ctx);
        const fallback = loadTokenFromGhCli(ctx);
        if (fallback) {
          try {
            resp = fetchUsage(ctx, fallback.token);
          } catch (e) {
            ctx.host.log.error("fallback usage request exception: " + String(e));
            throw "Usage request failed. Check your connection.";
          }
          if (resp.status >= 200 && resp.status < 300) {
            saveToken(ctx, fallback.token);
            token = fallback.token;
            source = fallback.source;
          }
        }
      }
      if (resp.status === 401 || resp.status === 403) {
        throw "Token invalid. Run `gh auth login` to re-authenticate.";
      }
    }

    if (resp.status < 200 || resp.status >= 300) {
      ctx.host.log.error("usage returned error: status=" + resp.status);
      throw (
        "Usage request failed (HTTP " +
        String(resp.status) +
        "). Try again later."
      );
    }

    if (source === "gh-cli") {
      saveToken(ctx, token);
    }

    const data = ctx.util.tryParseJson(resp.bodyText);
    if (data === null) {
      throw "Usage response invalid. Try again later.";
    }

    ctx.host.log.info("usage fetch succeeded");

    let plan = null;
    if (data.copilot_plan) {
      plan = ctx.fmt.planLabel(data.copilot_plan);
    }

    const mapped = mapUsage(ctx, data);
    return { plan: plan, lines: mapped.lines };
  }

  globalThis.__openusage_plugin = { id: "copilot", probe };
})();
