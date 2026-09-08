import { createLogger } from "@/logger";

const log = createLogger("github/compare");

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 10_000;

function authHeaders(token?: string): Record<string, string> | undefined {
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

// `token` is a short-lived GitHub App installation token (see github/app-auth.ts)
// — omit it for the unauthenticated, public-repos-only path.
export async function getDefaultBranch(githubRepo: string, token?: string): Promise<string> {
  const response = await fetch(`${GITHUB_API}/repos/${githubRepo}`, {
    headers: authHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    log.error("Failed to fetch repo", {
      githubRepo,
      status: response.status,
      rateLimitRemaining: response.headers.get("x-ratelimit-remaining"),
      body: await response.text(),
    });
    throw new Error(`Failed to fetch repo ${githubRepo}: ${response.status}`);
  }
  const data = (await response.json()) as { default_branch: string };
  log.info("Fetched default branch", { githubRepo, defaultBranch: data.default_branch });
  return data.default_branch;
}

export interface ChangedFile {
  filename: string;
  status: string;
}

// Deliberately base...head (not before/after) so this reflects cumulative
// drift from the shared baseline, not just the latest push's delta.
export async function compareBranches(
  owner: string,
  repo: string,
  base: string,
  head: string,
  token?: string,
): Promise<ChangedFile[]> {
  const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/compare/${base}...${head}`, {
    headers: authHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    log.error("Failed to compare branches", {
      owner,
      repo,
      base,
      head,
      status: response.status,
      rateLimitRemaining: response.headers.get("x-ratelimit-remaining"),
      body: await response.text(),
    });
    throw new Error(`Failed to compare ${base}...${head} on ${owner}/${repo}: ${response.status}`);
  }
  const data = (await response.json()) as { files?: { filename: string; status: string }[] };
  log.info("Compared branches", { owner, repo, base, head, changedFiles: data.files?.length ?? 0 });
  return (data.files ?? []).map((file) => ({ filename: file.filename, status: file.status }));
}
