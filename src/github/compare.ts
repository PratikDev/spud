
const GITHUB_API = "https://api.github.com";

export async function getDefaultBranch(owner: string, repo: string): Promise<string> {
  const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch repo ${owner}/${repo}: ${response.status}`);
  }
  const data = (await response.json()) as { default_branch: string };
  return data.default_branch;
}

export interface ChangedFile {
  filename: string;
  status: string;
}

// Deliberately base...head (not before/after) so this reflects cumulative
// drift from the shared baseline, not just the latest push's delta.
export async function compareBranches(owner: string, repo: string, base: string, head: string): Promise<ChangedFile[]> {
  const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/compare/${base}...${head}`);
  if (!response.ok) {
    throw new Error(`Failed to compare ${base}...${head} on ${owner}/${repo}: ${response.status}`);
  }
  const data = (await response.json()) as { files?: { filename: string; status: string }[] };
  return (data.files ?? []).map((file) => ({ filename: file.filename, status: file.status }));
}
