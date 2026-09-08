import { createSign } from "node:crypto";

import { env } from "@/env";
import { createLogger } from "@/logger";

const log = createLogger("github/app-auth");

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 10_000;

const privateKey = Buffer.from(env.GITHUB_APP_PRIVATE_KEY, "base64").toString("utf8");

export const APP_INSTALL_URL = `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

// Authenticates as the App itself (not any specific installation) — valid
// ~10 minutes, only used to look up an installation and mint a short-lived
// installation token from it.
export function signAppJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: now - 60, // allow for clock drift between this process and GitHub
    exp: now + 570, // GitHub's max is 10 minutes; stay comfortably under it
    iss: env.GITHUB_APP_ID,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey);
  return `${signingInput}.${base64url(signature)}`;
}

async function githubAppRequest(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${signAppJwt()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export interface InstallationToken {
  token: string;
  expiresAt: string;
}

// Looks up the installation for a specific repo, then mints a short-lived
// (1 hour) installation access token scoped to whatever permissions the App
// was granted. Returns null if the App isn't installed on that repo.
export async function getInstallationToken(owner: string, repo: string): Promise<InstallationToken | null> {
  const installationRes = await githubAppRequest(`/repos/${owner}/${repo}/installation`);
  if (installationRes.status === 404) {
    log.debug("App not installed on repo", { owner, repo });
    return null;
  }
  if (!installationRes.ok) {
    log.error("Failed to look up installation", { owner, repo, status: installationRes.status });
    throw new Error(`Failed to look up installation for ${owner}/${repo}: ${installationRes.status}`);
  }
  const installation = (await installationRes.json()) as { id: number };

  const tokenRes = await githubAppRequest(`/app/installations/${installation.id}/access_tokens`, { method: "POST" });
  if (!tokenRes.ok) {
    log.error("Failed to mint installation token", { owner, repo, status: tokenRes.status });
    throw new Error(`Failed to mint installation token for ${owner}/${repo}: ${tokenRes.status}`);
  }
  const data = (await tokenRes.json()) as { token: string; expires_at: string };
  log.info("Minted installation token", { owner, repo, installationId: installation.id });
  return { token: data.token, expiresAt: data.expires_at };
}

// Introspects the App itself — lets callers confirm what permissions are
// actually granted, since a permission mismatch means every install needs
// re-authorization before it'd take effect.
export async function getAppPermissions(): Promise<Record<string, string>> {
  const res = await githubAppRequest("/app");
  if (!res.ok) {
    throw new Error(`Failed to fetch app info: ${res.status}`);
  }
  const data = (await res.json()) as { permissions: Record<string, string> };
  return data.permissions;
}
