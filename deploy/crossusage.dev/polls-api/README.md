# Product polls API (Bun)

Tiny service: poll JSON in `polls/`, votes + dismissals in SQLite. App is a dumb shell.

## Anti-spam (best-effort)

`installId` is forgeable — do not treat it as proof of uniqueness.

| Guard | Default | Effect |
|-------|---------|--------|
| Max new votes/dismissals per IP per poll | `POLLS_MAX_VOTES_PER_IP=1` | Stops UUID-spray from one address |
| Burst vote/dismiss POSTs per IP | `POLLS_VOTE_BURST=5` / `POLLS_VOTE_BURST_WINDOW_MS=60000` | `429` on hammer loops |
| Install id shape | hex/dashes, 8–128 chars | Rejects garbage bodies |
| nginx `limit_req` | see `../nginx/crossusage.dev.conf` | Edge throttle before Bun |

Client IP from nginx `X-Real-IP` (hashed before store). VPNs still bypass IP caps; fine for product feedback polls.

## Endpoints

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/polls/active?appVersion=1.4.0` | Active poll JSON, or **204** if none |
| POST | `/api/polls/:id/vote` | `{ installId, optionId }` → `{ ok, results }` or `429` |
| POST | `/api/polls/:id/dismiss` | `{ installId, reason: "not_now" \| "dont_ask" }` → `{ ok }` |
| GET | `/api/polls/:id/results?installId=` | **Vote counts only** (after vote, or poll ended). No dismissals. |
| GET | `/api/polls/:id/stats` | **Admin only** — votes + dismissals. Header `X-Polls-Admin: $POLLS_ADMIN_TOKEN` |
| GET | `/api/polls/health` | Liveness |

### Admin stats (you only)

Set `POLLS_ADMIN_TOKEN` in the systemd unit (or drop-in). Never ship the token in the app.

```bash
curl -sS "https://crossusage.dev/api/polls/<poll-id>/stats" \
  -H "X-Polls-Admin: $POLLS_ADMIN_TOKEN" | jq .
# → { pollId, votes: { total, counts, winnerId }, dismissals: { total, not_now, dont_ask }, ended }
```

Without the header → `403`. Public results never include dismiss counts.

## Local run

```bash
cd deploy/crossusage.dev/polls-api
POLLS_ADMIN_TOKEN=dev-secret bun run server.ts
# → http://127.0.0.1:6740/api/polls/active
```

Flip `"active": true` on a file in `polls/` to publish.

## VPS install

```bash
sudo mkdir -p /opt/crossusage-polls-api /var/lib/crossusage-polls
# Do not --delete polls/: VPS may keep live poll JSON not in git
sudo rsync -a ./ /opt/crossusage-polls-api/ --exclude data --exclude polls
sudo rsync -a ./polls/ /opt/crossusage-polls-api/polls/
sudo chown -R www-data:www-data /opt/crossusage-polls-api /var/lib/crossusage-polls
sudo cp crossusage-polls.service /etc/systemd/system/
# Admin token (once): sudo systemctl edit crossusage-polls
#   [Service]
#   Environment=POLLS_ADMIN_TOKEN=…
sudo systemctl daemon-reload
sudo systemctl enable --now crossusage-polls
```

Nginx: `location /api/polls/` → `127.0.0.1:6740` (see `../nginx/crossusage.dev.conf`).
