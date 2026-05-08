import { FORK_GITHUB_REPO } from "@/lib/fork-meta"

const MULTI_ACCOUNT_CREDENTIALS_DOC = "docs/providers/multi-account-credentials.md"

/**
 * GitHub “blob” view of the multi-account credential tutorial (`HEAD` = repo default branch).
 */
export function multiAccountCredentialsGuideUrl(): string {
  return `https://github.com/${FORK_GITHUB_REPO}/blob/HEAD/${MULTI_ACCOUNT_CREDENTIALS_DOC}`
}
