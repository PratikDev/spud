import { createClient } from "@libsql/client";

import { env } from "@/env";
import { createLogger } from "@/logger";
import type { Project } from "@/types";

const log = createLogger("db");

const databaseUrl = env.TURSO_DATABASE_URL ?? `file:${env.DATABASE_PATH}`;
export const db = createClient({ url: databaseUrl, authToken: env.TURSO_AUTH_TOKEN });

if (databaseUrl.startsWith("file:")) {
  await db.execute("PRAGMA journal_mode = WAL;");
}
log.info("Database ready", { url: databaseUrl });

await db.execute(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
    channel_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    title TEXT NOT NULL,
    github_repo TEXT NOT NULL,
    default_branch TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'ended')) DEFAULT 'active',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    start_time INTEGER,
    end_time INTEGER,
    team_lead TEXT NOT NULL,
    handbook_message_id TEXT,
    ended_at INTEGER,
    board_message_id TEXT,
    gemini_api_key TEXT
  );
`);

// enforces "at most one active project per channel" at the DB level
await db.execute(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_active_per_channel
  ON projects (channel_id)
  WHERE status = 'active';
`);

// enforces "a repo can only be linked to one active project at a time" — the
// GitHub App's webhook is repo-scoped, not project-scoped, so this is also
// what lets it resolve a delivery to exactly one project.
await db.execute(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_active_per_repo
  ON projects (github_repo)
  WHERE status = 'active';
`);

await db.execute(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id TEXT NOT NULL,
    project_id INTEGER NOT NULL REFERENCES projects (id),
    description TEXT NOT NULL,
    owner TEXT,
    status TEXT NOT NULL CHECK (status IN ('unclaimed', 'claimed', 'done')) DEFAULT 'unclaimed',
    claimed_at INTEGER DEFAULT (strftime('%s', 'now')),
    UNIQUE (project_id, branch_id)
  );
`);

// Shared by every command that only makes sense in the context of "the active
// project in this channel" (project end/status, and later the claim board commands).
export async function getActiveProject(channelId: string): Promise<Project | null> {
  const rs = await db.execute({
    sql: "SELECT * FROM projects WHERE channel_id = ? AND status = 'active'",
    args: [channelId],
  });
  const project = (rs.rows[0] as unknown as Project | undefined) ?? null;
  log.debug(project ? "Found active project for channel" : "No active project for channel", { channelId });
  return project;
}

// Used by the GitHub App's webhook handler, which resolves a delivery to a
// project by the payload's repository full name rather than a URL param —
// there's only ever one active project per repo (see idx_projects_active_per_repo).
export async function getActiveProjectByRepo(githubRepo: string): Promise<Project | null> {
  const rs = await db.execute({
    sql: "SELECT * FROM projects WHERE github_repo = ? AND status = 'active'",
    args: [githubRepo],
  });
  const project = (rs.rows[0] as unknown as Project | undefined) ?? null;
  log.debug(project ? "Found active project by repo" : "No active project for repo", { githubRepo });
  return project;
}

// A guild can have multiple active projects at once (one per channel), so this
// ends all of them, not just one.
export async function endActiveProjectsForGuild(guildId: string): Promise<number> {
  const rs = await db.execute({
    sql: "UPDATE projects SET status = 'ended', ended_at = strftime('%s', 'now') WHERE guild_id = ? AND status = 'active'",
    args: [guildId],
  });
  log.debug("Ended active projects for guild", { guildId, count: rs.rowsAffected });
  return rs.rowsAffected;
}
