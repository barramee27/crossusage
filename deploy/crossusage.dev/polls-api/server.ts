/**
 * Tiny product-polls API for crossusage.dev.
 * Bun + SQLite. Poll definitions = JSON files in ./polls/
 *
 * Env:
 *   POLLS_PORT (default 6740)
 *   POLLS_DIR (default ./polls)
 *   POLLS_DB (default ./data/votes.sqlite)
 *   POLLS_ADMIN_TOKEN (required for GET …/stats + unrestricted results)
 *   POLLS_MAX_VOTES_PER_IP (default 1) — new votes/dismissals per IP per poll
 *   POLLS_VOTE_BURST (default 5) — vote/dismiss POSTs per IP per window
 *   POLLS_VOTE_BURST_WINDOW_MS (default 60000)
 */

import { Database } from "bun:sqlite"
import { createHash, randomUUID } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"

const PORT = Number(process.env.POLLS_PORT ?? 6740)
const POLLS_DIR = resolve(process.env.POLLS_DIR ?? join(import.meta.dir, "polls"))
const DB_PATH = resolve(process.env.POLLS_DB ?? join(import.meta.dir, "data", "votes.sqlite"))
const ADMIN_TOKEN = process.env.POLLS_ADMIN_TOKEN ?? ""
const MAX_VOTES_PER_IP = Math.max(1, Number(process.env.POLLS_MAX_VOTES_PER_IP ?? 1))
const VOTE_BURST = Math.max(1, Number(process.env.POLLS_VOTE_BURST ?? 5))
const VOTE_BURST_WINDOW_MS = Math.max(1000, Number(process.env.POLLS_VOTE_BURST_WINDOW_MS ?? 60_000))

const DISMISS_REASONS = ["not_now", "dont_ask"] as const
export type DismissReason = (typeof DISMISS_REASONS)[number]

export type PollOption = { id: string; label: string }
export type PollDef = {
  id: string
  version?: number
  title: string
  body?: string
  options: PollOption[]
  allowDismiss?: boolean
  minAppVersion?: string
  expiresAt?: string
  active?: boolean
  ended?: boolean
}

type VoteRow = { option_id: string; n: number }
type ReasonRow = { reason: string; n: number }

/** Sliding-window burst tracker (in-memory; resets on restart). */
const burstBuckets = new Map<string, number[]>()

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Polls-Admin",
    "Access-Control-Max-Age": "86400",
  }
}

function json(data: unknown, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...extra,
    },
  })
}

function empty(status = 204): Response {
  return new Response(null, { status, headers: corsHeaders() })
}

function rateLimited(retryAfterSec: number): Response {
  return json(
    { error: "rate_limited", retryAfter: retryAfterSec },
    429,
    { "Retry-After": String(retryAfterSec) },
  )
}

function isAdmin(req: Request): boolean {
  return Boolean(ADMIN_TOKEN) && req.headers.get("X-Polls-Admin") === ADMIN_TOKEN
}

function hashInstallId(installId: string): string {
  return createHash("sha256").update(`crossusage-poll:${installId}`).digest("hex")
}

function hashIp(ip: string): string {
  return createHash("sha256").update(`crossusage-poll-ip:${ip}`).digest("hex")
}

/** Prefer nginx X-Real-IP; fall back to first X-Forwarded-For hop. */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim()
  if (real) return real
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  if (xff) return xff
  return "unknown"
}

/** UUID v4-ish (app install ids); rejects empty/garbage. */
export function isValidInstallId(id: string): boolean {
  if (id.length < 8 || id.length > 128) return false
  return /^[0-9a-fA-F-]{8,128}$/.test(id)
}

export function isValidDismissReason(r: string): r is DismissReason {
  return (DISMISS_REASONS as readonly string[]).includes(r)
}

/**
 * Record a vote/dismiss attempt for burst limiting.
 * Returns retry-after seconds if over limit, else null.
 */
export function checkBurst(ipHash: string, now = Date.now()): number | null {
  const cutoff = now - VOTE_BURST_WINDOW_MS
  const prev = burstBuckets.get(ipHash) ?? []
  const recent = prev.filter((t) => t > cutoff)
  if (recent.length >= VOTE_BURST) {
    burstBuckets.set(ipHash, recent)
    const oldest = recent[0]!
    return Math.max(1, Math.ceil((oldest + VOTE_BURST_WINDOW_MS - now) / 1000))
  }
  recent.push(now)
  burstBuckets.set(ipHash, recent)
  if (burstBuckets.size > 10_000) {
    for (const [k, ts] of burstBuckets) {
      if (ts.every((t) => t <= cutoff)) burstBuckets.delete(k)
    }
  }
  return null
}

function parseSemverParts(v: string): number[] | null {
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** Return true if appVersion >= minVersion (semver major.minor.patch prefix). */
export function versionSatisfies(appVersion: string | null, minVersion: string | undefined): boolean {
  if (!minVersion) return true
  if (!appVersion) return true
  const a = parseSemverParts(appVersion)
  const b = parseSemverParts(minVersion)
  if (!a || !b) return true
  for (let i = 0; i < 3; i++) {
    if (a[i]! > b[i]!) return true
    if (a[i]! < b[i]!) return false
  }
  return true
}

export function isExpired(expiresAt: string | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false
  const t = Date.parse(expiresAt)
  return Number.isFinite(t) && t <= now
}

function loadPollDefs(): PollDef[] {
  if (!existsSync(POLLS_DIR)) return []
  const out: PollDef[] = []
  for (const name of readdirSync(POLLS_DIR)) {
    if (!name.endsWith(".json")) continue
    try {
      const raw = JSON.parse(readFileSync(join(POLLS_DIR, name), "utf8")) as PollDef
      if (!raw?.id || !raw.title || !Array.isArray(raw.options)) continue
      if (raw.options.length < 2 || raw.options.length > 8) continue
      if (!raw.options.every((o) => o?.id && typeof o.label === "string")) continue
      out.push(raw)
    } catch {
      // skip bad files
    }
  }
  return out
}

/**
 * Published poll for GET /active.
 * Open polls win; if none, keep the published ended/expired poll so results + winner stay visible.
 * Set `"active": false` to hide it. `expiresAt` / `ended` stop new votes (410).
 */
export function selectActivePoll(
  polls: PollDef[],
  appVersion: string | null,
  now = Date.now(),
): PollDef | null {
  const published = polls.filter(
    (p) => p.active === true && versionSatisfies(appVersion, p.minAppVersion),
  )
  const open = published.filter((p) => !p.ended && !isExpired(p.expiresAt, now))
  return open[0] ?? published[0] ?? null
}

function getActivePoll(appVersion: string | null): PollDef | null {
  return selectActivePoll(loadPollDefs(), appVersion)
}

function getPollById(id: string): PollDef | null {
  return loadPollDefs().find((p) => p.id === id) ?? null
}

function ensureDb(): Database {
  mkdirSync(resolve(DB_PATH, ".."), { recursive: true })
  const database = new Database(DB_PATH, { create: true })
  database.exec(`
    CREATE TABLE IF NOT EXISTS votes (
      poll_id TEXT NOT NULL,
      install_hash TEXT NOT NULL,
      option_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (poll_id, install_hash)
    );
    CREATE TABLE IF NOT EXISTS dismissals (
      poll_id TEXT NOT NULL,
      install_hash TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      ip_hash TEXT,
      PRIMARY KEY (poll_id, install_hash)
    );
  `)
  const cols = database.query<{ name: string }, []>(`PRAGMA table_info(votes)`).all()
  if (!cols.some((c) => c.name === "ip_hash")) {
    database.exec(`ALTER TABLE votes ADD COLUMN ip_hash TEXT`)
  }
  database.exec(`CREATE INDEX IF NOT EXISTS idx_votes_poll_ip ON votes(poll_id, ip_hash)`)
  database.exec(`CREATE INDEX IF NOT EXISTS idx_dismiss_poll ON dismissals(poll_id)`)
  return database
}

const db = ensureDb()

function voteCounts(pollId: string): Record<string, number> {
  const rows = db
    .query<VoteRow, [string]>(
      `SELECT option_id, COUNT(*) AS n FROM votes WHERE poll_id = ? GROUP BY option_id`,
    )
    .all(pollId)
  const counts: Record<string, number> = {}
  for (const row of rows) counts[row.option_id] = Number(row.n)
  return counts
}

function dismissCounts(pollId: string): { total: number; not_now: number; dont_ask: number } {
  const rows = db
    .query<ReasonRow, [string]>(
      `SELECT reason, COUNT(*) AS n FROM dismissals WHERE poll_id = ? GROUP BY reason`,
    )
    .all(pollId)
  const out = { total: 0, not_now: 0, dont_ask: 0 }
  for (const row of rows) {
    const n = Number(row.n)
    out.total += n
    if (row.reason === "not_now") out.not_now = n
    if (row.reason === "dont_ask") out.dont_ask = n
  }
  return out
}

function hasVoted(pollId: string, installHash: string): boolean {
  const row = db
    .query<{ c: number }, [string, string]>(
      `SELECT COUNT(*) AS c FROM votes WHERE poll_id = ? AND install_hash = ?`,
    )
    .get(pollId, installHash)
  return (row?.c ?? 0) > 0
}

function hasDismissed(pollId: string, installHash: string): boolean {
  const row = db
    .query<{ c: number }, [string, string]>(
      `SELECT COUNT(*) AS c FROM dismissals WHERE poll_id = ? AND install_hash = ?`,
    )
    .get(pollId, installHash)
  return (row?.c ?? 0) > 0
}

function votesFromIp(pollId: string, ipHash: string): number {
  const row = db
    .query<{ c: number }, [string, string]>(
      `SELECT COUNT(*) AS c FROM votes WHERE poll_id = ? AND ip_hash = ?`,
    )
    .get(pollId, ipHash)
  return row?.c ?? 0
}

function dismissalsFromIp(pollId: string, ipHash: string): number {
  const row = db
    .query<{ c: number }, [string, string]>(
      `SELECT COUNT(*) AS c FROM dismissals WHERE poll_id = ? AND ip_hash = ?`,
    )
    .get(pollId, ipHash)
  return row?.c ?? 0
}

function resultsPayload(poll: PollDef) {
  const counts = voteCounts(poll.id)
  let total = 0
  for (const n of Object.values(counts)) total += n
  let winnerId: string | null = null
  let winnerN = -1
  for (const opt of poll.options) {
    const n = counts[opt.id] ?? 0
    if (n > winnerN) {
      winnerN = n
      winnerId = opt.id
    } else if (n === winnerN && winnerId !== null) {
      winnerId = null // tie
    }
  }
  return {
    pollId: poll.id,
    total,
    counts,
    winnerId,
    ended: Boolean(poll.ended) || isExpired(poll.expiresAt),
  }
}

function adminStatsPayload(poll: PollDef) {
  const votes = resultsPayload(poll)
  return {
    pollId: poll.id,
    votes: {
      total: votes.total,
      counts: votes.counts,
      winnerId: votes.winnerId,
    },
    dismissals: dismissCounts(poll.id),
    ended: votes.ended,
  }
}

function publicPoll(poll: PollDef) {
  return {
    id: poll.id,
    version: poll.version ?? 1,
    title: poll.title,
    body: poll.body ?? null,
    options: poll.options,
    allowDismiss: poll.allowDismiss !== false,
    minAppVersion: poll.minAppVersion ?? null,
    expiresAt: poll.expiresAt ?? null,
    ended: Boolean(poll.ended) || isExpired(poll.expiresAt),
  }
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return empty(204)

  const url = new URL(req.url)
  const path = url.pathname.replace(/\/+$/, "") || "/"
  const stripped = path.replace(/^\/api\/polls/, "") || "/"

  if (req.method === "GET" && (stripped === "/" || stripped === "/active")) {
    const appVersion = url.searchParams.get("appVersion")
    const poll = getActivePoll(appVersion)
    if (!poll) return empty(204)
    return json(publicPoll(poll), 200, {
      "Cache-Control": "public, max-age=60",
    })
  }

  const voteMatch = stripped.match(/^\/([^/]+)\/vote$/)
  if (req.method === "POST" && voteMatch) {
    const pollId = voteMatch[1]!
    const poll = getPollById(pollId)
    if (!poll || poll.active !== true) {
      return json({ error: "poll_not_found" }, 404)
    }
    if (poll.ended || isExpired(poll.expiresAt)) {
      return json({ error: "poll_ended" }, 410)
    }

    let body: { installId?: string; optionId?: string }
    try {
      body = (await req.json()) as { installId?: string; optionId?: string }
    } catch {
      return json({ error: "invalid_json" }, 400)
    }

    const installId = typeof body.installId === "string" ? body.installId.trim() : ""
    const optionId = typeof body.optionId === "string" ? body.optionId.trim() : ""
    if (!isValidInstallId(installId)) return json({ error: "invalid_install" }, 400)
    if (!poll.options.some((o) => o.id === optionId)) {
      return json({ error: "invalid_option" }, 400)
    }

    const installHash = hashInstallId(installId)
    const existing = hasVoted(pollId, installHash)
    if (existing) {
      return json({ ok: true, alreadyVoted: true, results: resultsPayload(poll) })
    }

    const ip = clientIp(req)
    const ipHash = hashIp(ip)
    const burstRetry = checkBurst(ipHash)
    if (burstRetry !== null) return rateLimited(burstRetry)

    if (votesFromIp(pollId, ipHash) >= MAX_VOTES_PER_IP) {
      return rateLimited(Math.ceil(VOTE_BURST_WINDOW_MS / 1000))
    }
    db.query(
      `INSERT INTO votes (poll_id, install_hash, option_id, created_at, ip_hash) VALUES (?, ?, ?, ?, ?)`,
    ).run(pollId, installHash, optionId, new Date().toISOString(), ipHash)

    return json({ ok: true, alreadyVoted: false, results: resultsPayload(poll) })
  }

  const dismissMatch = stripped.match(/^\/([^/]+)\/dismiss$/)
  if (req.method === "POST" && dismissMatch) {
    const pollId = dismissMatch[1]!
    const poll = getPollById(pollId)
    if (!poll || poll.active !== true) {
      return json({ error: "poll_not_found" }, 404)
    }

    let body: { installId?: string; reason?: string }
    try {
      body = (await req.json()) as { installId?: string; reason?: string }
    } catch {
      return json({ error: "invalid_json" }, 400)
    }

    const installId = typeof body.installId === "string" ? body.installId.trim() : ""
    const reason = typeof body.reason === "string" ? body.reason.trim() : ""
    if (!isValidInstallId(installId)) return json({ error: "invalid_install" }, 400)
    if (!isValidDismissReason(reason)) return json({ error: "invalid_reason" }, 400)

    const installHash = hashInstallId(installId)
    if (hasDismissed(pollId, installHash)) {
      return json({ ok: true, alreadyDismissed: true })
    }

    const ip = clientIp(req)
    const ipHash = hashIp(ip)
    const burstRetry = checkBurst(ipHash)
    if (burstRetry !== null) return rateLimited(burstRetry)

    if (dismissalsFromIp(pollId, ipHash) >= MAX_VOTES_PER_IP) {
      return rateLimited(Math.ceil(VOTE_BURST_WINDOW_MS / 1000))
    }

    db.query(
      `INSERT INTO dismissals (poll_id, install_hash, reason, created_at, ip_hash) VALUES (?, ?, ?, ?, ?)`,
    ).run(pollId, installHash, reason, new Date().toISOString(), ipHash)

    return json({ ok: true, alreadyDismissed: false })
  }

  const resultsMatch = stripped.match(/^\/([^/]+)\/results$/)
  if (req.method === "GET" && resultsMatch) {
    const pollId = resultsMatch[1]!
    const poll = getPollById(pollId)
    if (!poll) return json({ error: "poll_not_found" }, 404)

    const admin = isAdmin(req)
    const installId = url.searchParams.get("installId")?.trim() ?? ""
    const ended = Boolean(poll.ended) || isExpired(poll.expiresAt)

    if (!admin && !ended) {
      if (!installId) return json({ error: "forbidden" }, 403)
      if (!hasVoted(pollId, hashInstallId(installId))) {
        return json({ error: "vote_required" }, 403)
      }
    }

    // Public results: votes only — never dismissals.
    return json(resultsPayload(poll), 200, {
      "Cache-Control": "no-store",
    })
  }

  const statsMatch = stripped.match(/^\/([^/]+)\/stats$/)
  if (req.method === "GET" && statsMatch) {
    if (!ADMIN_TOKEN) return json({ error: "admin_disabled" }, 503)
    if (!isAdmin(req)) return json({ error: "forbidden" }, 403)
    const poll = getPollById(statsMatch[1]!)
    if (!poll) return json({ error: "poll_not_found" }, 404)
    return json(adminStatsPayload(poll), 200, { "Cache-Control": "no-store" })
  }

  if (req.method === "GET" && stripped === "/health") {
    return json({ ok: true, id: randomUUID().slice(0, 8) })
  }

  return json({ error: "not_found" }, 404)
}

if (import.meta.main) {
  const server = Bun.serve({ port: PORT, fetch: handleRequest })
  console.log(`polls-api listening on http://127.0.0.1:${server.port}`)
  console.log(`polls dir: ${POLLS_DIR}`)
  console.log(`db: ${DB_PATH}`)
  console.log(`admin stats: ${ADMIN_TOKEN ? "enabled" : "disabled (set POLLS_ADMIN_TOKEN)"}`)
  console.log(`anti-spam: max ${MAX_VOTES_PER_IP} votes/IP/poll, burst ${VOTE_BURST}/${VOTE_BURST_WINDOW_MS}ms`)
}
