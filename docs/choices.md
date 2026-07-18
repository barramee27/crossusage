# Choices

## 2026-07-17

- **#962 Claude Desktop Safe Storage:** **later** for 1.3.3 — macOS-centric decrypt; Linux/Windows has no equivalent store path worth shipping half-baked.
- **Phase 3 UI/CLI (#989, #982):** stay **later**; fork already has CLI/HTTP.
- **Pi fold-in at `query_daily_since`:** Claude/Codex merge pi rows even when the native scan returns no files/empty, so pi-only usage still shows on those cards (matches upstream `DailyUsageAccumulator.merged`).
- **Pi scanner:** no incremental file cache (simpler; ~350 LOC budget). Re-parse session files each query.
- **Unknown pi models:** skipped from totals (no `unknownModelsByDay` on `DailyUsageRow`); same as existing Claude/Codex Rust aggregate.
- **Cursor enterprise on-demand without limit:** CrossUsage has no `values` MetricLine; emit `text` (`$X.XX`) when usage-summary has used>0 but no positive limit (Swift uses `.values`).
