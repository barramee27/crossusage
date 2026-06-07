import { isTauri } from "@tauri-apps/api/core"
import type { UsageDailyRow } from "@/lib/usage-daily"

export type UsageHistoryExportRow = {
  capturedAtMs: number
  instanceId: string
  displayName: string
  primaryPercent: number
  plan: string | null
}

const CSV_BOM = "\uFEFF"

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/** Quote every cell so LibreOffice/Calc does not glue `21.06` + `Pro` into one column. */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/** Match Settings table / charts (one decimal, 0–100). */
export function formatUsagePercent(n: number): string {
  if (!Number.isFinite(n)) return ""
  return (Math.round(n * 10) / 10).toFixed(1)
}

function withCsvBom(content: string): string {
  return `${CSV_BOM}${content}`
}

function joinCsvLines(lines: string[]): string {
  return withCsvBom(lines.join("\r\n"))
}

function commentLine(text: string): string {
  return `# ${text}`
}

function sumTokens(rows: UsageDailyRow[]): number {
  return rows.reduce((sum, row) => sum + (row.totalTokens ?? 0), 0)
}

function sumCost(rows: UsageDailyRow[]): number | null {
  let total = 0
  let any = false
  for (const row of rows) {
    if (row.costUsd != null && Number.isFinite(row.costUsd)) {
      total += row.costUsd
      any = true
    }
  }
  return any ? total : null
}

function dayRange(rows: UsageDailyRow[]): { from: string | null; to: string | null } {
  if (rows.length === 0) return { from: null, to: null }
  const days = rows.map((r) => r.dayKey).sort()
  return { from: days[0] ?? null, to: days[days.length - 1] ?? null }
}

function sourceNote(source: string): string {
  if (source === "cursor_billing") {
    return "Cursor dashboard billing CSV (includes cost USD)"
  }
  if (source === "cursor_transcripts") {
    return "local transcript token estimate only; refresh Cursor to pull billing rows"
  }
  if (source === "ccusage" || source.includes("ccusage")) {
    return "from local Claude/Codex usage logs"
  }
  return source
}

export function buildQuotaHistoryCsv(rows: UsageHistoryExportRow[]): string {
  const generated = new Date().toISOString()
  const header = "captured_at,instance_id,display_name,usage_percent,plan"
  const meta = [
    commentLine(`CrossUsage quota snapshot export`),
    commentLine(`generated_at,${generated}`),
    commentLine(`rows,${rows.length}`),
    commentLine(`description,Quota usage percent 0-100 after each successful provider refresh`),
    commentLine(`note,usage_percent is rounded to 1 decimal; includes all enabled providers`),
    commentLine(`libreoffice_hint,UTF-8 comma-separated; quoted cells avoid 21.06Pro merge bugs`),
    "",
  ]
  const dataLines = rows.map((r) => {
    const at = new Date(r.capturedAtMs).toISOString()
    const plan = r.plan ?? ""
    return [
      csvCell(at),
      csvCell(r.instanceId),
      csvCell(r.displayName),
      csvCell(formatUsagePercent(r.primaryPercent)),
      csvCell(plan),
    ].join(",")
  })
  return joinCsvLines([...meta, header, ...dataLines])
}

export function buildDailyTokensCsv(rows: UsageDailyRow[]): string {
  const generated = new Date().toISOString()
  const { from, to } = dayRange(rows)
  const totalTokens = sumTokens(rows)
  const totalCost = sumCost(rows)
  const header =
    "day,provider,account_key,total_tokens,input_tokens,output_tokens,cost_usd,source,notes"
  const meta = [
    commentLine(`CrossUsage daily token export`),
    commentLine(`generated_at,${generated}`),
    commentLine(`rows,${rows.length}`),
    commentLine(`date_from,${from ?? ""}`),
    commentLine(`date_to,${to ?? ""}`),
    commentLine(`total_tokens,${totalTokens}`),
    commentLine(`total_cost_usd,${totalCost != null ? totalCost.toFixed(4) : ""}`),
    commentLine(
      `note,provider column matches Quota over time chart; account_key is internal (cursor, cursor:work)`,
    ),
    commentLine(
      `note,cost_usd comes from cursor_billing rows after a successful Cursor refresh`,
    ),
    commentLine(`libreoffice_hint,Data → Text to Columns → Separated by → Comma`),
    "",
  ]
  const dataLines = rows.map((r) => {
    const notes = r.costUsd == null ? sourceNote(r.source) : ""
    return [
      csvEscape(r.dayKey),
      csvEscape(r.displayName),
      csvEscape(r.instanceId),
      r.totalTokens != null ? String(r.totalTokens) : "",
      r.inputTokens != null ? String(r.inputTokens) : "",
      r.outputTokens != null ? String(r.outputTokens) : "",
      r.costUsd != null ? String(r.costUsd) : "",
      csvEscape(r.source),
      csvEscape(notes),
    ].join(",")
  })

  const byInstance = new Map<string, { label: string; tokens: number; cost: number | null }>()
  for (const row of rows) {
    const prev = byInstance.get(row.instanceId) ?? {
      label: row.displayName,
      tokens: 0,
      cost: null as number | null,
    }
    prev.tokens += row.totalTokens ?? 0
    if (row.costUsd != null && Number.isFinite(row.costUsd)) {
      prev.cost = (prev.cost ?? 0) + row.costUsd
    }
    byInstance.set(row.instanceId, prev)
  }
  const summary =
    byInstance.size > 0
      ? [
          "",
          commentLine("--- totals by account ---"),
          ...Array.from(byInstance.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([id, v]) =>
              commentLine(
                `${id},${v.label},tokens=${v.tokens},cost_usd=${v.cost != null ? v.cost.toFixed(4) : ""}`,
              ),
            ),
        ]
      : []

  return joinCsvLines([...meta, header, ...dataLines, ...summary])
}

export function buildExportSummary(
  quotaRows: UsageHistoryExportRow[],
  dailyRows: UsageDailyRow[],
): string {
  const generated = new Date().toISOString()
  const { from, to } = dayRange(dailyRows)
  const totalTokens = sumTokens(dailyRows)
  const totalCost = sumCost(dailyRows)
  const lines = [
    "CrossUsage usage export",
    `Generated: ${generated}`,
    "",
    "Files in this folder:",
    "  crossusage-daily-tokens-*.csv   — per-day token totals",
    "  crossusage-quota-history-*.csv  — quota % snapshots over time",
    "",
    `Daily token rows: ${dailyRows.length}`,
  ]
  if (from && to) lines.push(`Daily date range: ${from} to ${to}`)
  lines.push(`Total tokens (daily file): ${totalTokens.toLocaleString("en-US")}`)
  if (totalCost != null) {
    lines.push(`Total cost USD (daily file): $${totalCost.toFixed(2)}`)
  } else if (dailyRows.some((r) => r.source === "cursor_transcripts")) {
    lines.push(
      "Total cost USD: missing — only transcript estimates saved so far.",
      "Refresh Cursor in CrossUsage, then export again (billing rows use source=cursor_billing).",
    )
  }
  lines.push("", `Quota snapshot rows: ${quotaRows.length}`)
  lines.push(
    "",
    "Open CSV in LibreOffice:",
    "  If all data is in column A, use Data → Text to Columns → Separated by → Comma.",
    "  UTF-8 BOM is included so most apps split columns automatically.",
  )
  return lines.join("\n")
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Browser fallback: downloads to the browser default folder (usually ~/Downloads). */
export function downloadUsageHistoryCsv(
  quotaRows: UsageHistoryExportRow[],
  dailyRows: UsageDailyRow[],
): void {
  const stamp = new Date().toISOString().slice(0, 10)
  downloadTextFile(`crossusage-daily-tokens-${stamp}.csv`, buildDailyTokensCsv(dailyRows))
  downloadTextFile(`crossusage-quota-history-${stamp}.csv`, buildQuotaHistoryCsv(quotaRows))
}

export type UsageHistoryExportResult = {
  directory: string
  files: string[]
}

/** Desktop: native folder picker, then writes CSV + summary text into that folder. */
export async function exportUsageHistoryToFolder(
  quotaRows: UsageHistoryExportRow[],
  dailyRows: UsageDailyRow[],
): Promise<UsageHistoryExportResult | null> {
  if (!isTauri()) {
    downloadUsageHistoryCsv(quotaRows, dailyRows)
    return null
  }

  const { open } = await import("@tauri-apps/plugin-dialog")
  const { writeTextFile } = await import("@tauri-apps/plugin-fs")

  const picked = await open({
    directory: true,
    multiple: false,
    title: "Choose folder for usage export",
  })
  if (!picked || Array.isArray(picked)) return null

  const directory = picked.replace(/\/$/, "")
  const stamp = new Date().toISOString().slice(0, 10)
  const names = [
    `crossusage-daily-tokens-${stamp}.csv`,
    `crossusage-quota-history-${stamp}.csv`,
    `crossusage-export-summary-${stamp}.txt`,
  ] as const
  const paths = names.map((name) => `${directory}/${name}`)

  await writeTextFile(paths[0], buildDailyTokensCsv(dailyRows))
  await writeTextFile(paths[1], buildQuotaHistoryCsv(quotaRows))
  await writeTextFile(paths[2], buildExportSummary(quotaRows, dailyRows))

  return { directory, files: paths }
}
