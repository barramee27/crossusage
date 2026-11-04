# Pitfalls

## 2026-11-04 — Cloud Code may omit Gemini quota for an old or unversioned client identity

CrossUsage 1.6.1 displayed only the Claude/GPT Antigravity CLI quota although `agy /quota` showed Gemini five-hour and weekly quotas on the same account. The Cloud Code summary response was valid but incomplete for `User-Agent: antigravity`; the plugin accepted its two third-party buckets and skipped the legacy fallback. An isolated probe with `antigravity/cli/1.5.0` restored the Gemini buckets, while `antigravity/cli/1.0.0` reproduced the omission. Use a versioned client identity verified against the native CLI and check all expected bucket groups.
