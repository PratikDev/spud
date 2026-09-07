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
    webhook_secret TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'ended')) DEFAULT 'active',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    start_time INTEGER,
    end_time INTEGER,
    team_lead TEXT NOT NULL,
    rulebook_message_id TEXT,
    ended_at INTEGER,
    board_message_id TEXT
  );
`);

// enforces "at most one active project per channel" at the DB level
await db.execute(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_active_per_channel
  ON projects (channel_id)
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

// Used by the GitHub webhook handler, which only has {public_id} from the URL —
// it may be looking up an ended project too (see the "ended projects still get
// stray webhook traffic" case), so this doesn't filter by status like the one above.
// public_id (not the internal auto-increment id) is used here since it's exposed
// in the webhook payload URL and shouldn't reveal a guessable sequential number.
export async function getProjectByPublicId(publicId: string): Promise<Project | null> {
  const rs = await db.execute({ sql: "SELECT * FROM projects WHERE public_id = ?", args: [publicId] });
  const project = (rs.rows[0] as unknown as Project | undefined) ?? null;
  log.debug(project ? "Found project by public id" : "No project found by public id", { publicId });
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
