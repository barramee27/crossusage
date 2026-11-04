# Decisions

## 2026-11-04 — Identify the Antigravity CLI quota client with a versioned User-Agent

CrossUsage sends `antigravity/cli/1.5.0` to `retrieveUserQuotaSummary` for the Antigravity CLI provider. On a Windows account with `agy` 1.5.0, the previous unversioned `antigravity` identity returned only `3p-5h` and `3p-weekly`. The versioned identity returned `gemini-5h`, `gemini-weekly`, and the same third-party buckets. This changes quota presentation only; the existing Google credential and Cloud Code endpoint order remain in use.

The version string reflects the CLI version tested on 2026-11-04. Reconsider it when Google changes the accepted client identity, when `agy` advances, or when a supported host API can provide the installed CLI version without adding an unreliable filesystem or process scan. A partial summary must not be treated as proof that the absent buckets do not exist.
