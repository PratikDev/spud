import { Database } from "bun:sqlite";

export const db = new Database(process.env.DATABASE_PATH ?? "spud.sqlite");

db.run("PRAGMA journal_mode = WAL;");

db.run(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    title TEXT NOT NULL,
    github_repo TEXT NOT NULL,
    webhook_secret TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'ended')) DEFAULT 'active',
    started_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    ended_at INTEGER,
    board_message_id TEXT
  );
`);

// enforces "at most one active project per channel" at the DB level
db.run(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_active_per_channel
  ON projects (channel_id)
  WHERE status = 'active';
`);

db.run(`
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
