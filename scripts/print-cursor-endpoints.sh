#!/usr/bin/env bash
# Print full Cursor-related URLs as used by plugins/cursor/plugin.js (and CLI oauth/export).
# No network calls — for quick reference when comparing to DevTools or docs.

set -euo pipefail
BASE="https://api2.cursor.sh"
echo "=== api2.cursor.sh (from plugins/cursor/plugin.js) ==="
echo "${BASE}/aiserver.v1.DashboardService/GetCurrentPeriodUsage"
echo "${BASE}/aiserver.v1.DashboardService/GetPlanInfo"
echo "${BASE}/oauth/token"
echo "${BASE}/aiserver.v1.DashboardService/GetCreditGrantsBalance"
echo "${BASE}/aiserver.v1.DashboardService/GetUsageLimitStatusAndActiveGrants"
echo ""
echo "=== cursor.com (from plugins/cursor/plugin.js) ==="
echo "https://cursor.com/api/usage"
echo "https://cursor.com/api/auth/stripe"
echo ""
echo "=== crossusage-cli (cursor_token_usage.rs) ==="
echo "${BASE}/oauth/token"
echo "https://cursor.com/api/dashboard/export-usage-events-csv"
