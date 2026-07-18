# PRD — Spud - Hackathon Task-Coordination Discord Bot

## Problem
- Teammates unknowingly duplicate work — two people build the same feature without knowing the other has started
- Claimed tasks silently grow in scope ("vibe coding") — no visibility into whether someone's still working on what they said
- Existing chat tools (WhatsApp groups, etc.) fail because task state gets buried in scroll
- Full task management tools (Jira, Linear, etc.) are overkill for a 2–3 day hackathon

## Goals
- Give a team a always-visible, always-current view of who's working on what
- Catch task collisions *before* they happen, not after
- Catch scope drift automatically, without requiring anyone to self-report
- Support reuse across multiple hackathons/projects, including concurrently in the same server

## Non-goals (explicitly out of scope for MVP)
- Due dates, priorities, dependencies, kanban columns
- PR-based gating or merge checks
- Verifying commit author identity matches task claimant
- Periodic "what are you working on" check-in pings
- Auto-generating a full task breakdown from a one-line project idea

---

## Feature 0: Project Lifecycle (admin-only)

**Why:** the bot needs to be reusable across events and safe from members spinning up chaos in a server with no active project.

**Scoping decision:** a project is scoped to a **channel**, not the whole server. This supports the same Discord server hosting multiple concurrent hackathons/teams in different channels, with zero collision between their boards or task data. Guild-level scoping was considered and rejected — it would break the moment two teams use the same server at once.

**Behavior:**
- No commands are available to regular members until an admin starts a project *in that channel*
- Admin-only gating uses Discord's built-in `Administrator` permission (or a specific role) — not manual user ID checks
- A channel can have at most one *active* project at a time; starting a new one requires ending the current one first
- Ending a project archives its data (does not delete) — task history remains queryable for reference later

**Commands:**
| Command | Access | Description |
|---|---|---|
| `/project start <title> <github-repo>` | Admin | Starts a new active project in this channel, linking a GitHub repo |
| `/project end` | Admin | Ends the active project in this channel, archives its board/task data |
| `/project status` | Admin | Shows the active project's title, repo, and task counts for this channel |
| `/project list` | Admin | Lists all active projects across the server (bird's-eye view for admins juggling multiple teams) |

---

## Feature 1: The Claim Board

**Why:** single source of truth for "who's doing what," replacing the unreliable scroll-and-hope of a group chat.

**Behavior:**
- Pinned embed in the project's channel, auto-updated on every state change
- Shows: task description, owner, branch name/ID, status (claimed / done / free)
- Separate section for unclaimed / "up for grabs" tasks
- All commands below operate only on the active project in the current channel; if none exists, the bot replies that an admin needs to start one

**`/claim` behavior — handles both new and existing tasks:**
- The task description field autocompletes against currently *unclaimed* task descriptions as the user types
- If they select an existing unclaimed task from autocomplete → bot claims that exact task under its existing branch ID, no new branch generated, no overlap check re-run (it was already checked when originally created)
- If they type free text that doesn't match an existing unclaimed task → bot treats it as a new task: runs overlap detection (Feature 2), generates a branch name (Feature 3), creates the task, and claims it
- This means members can either pick up work someone already scoped out but hasn't started, or spin up a brand new task — same command either way

**Commands:**
| Command | Description |
|---|---|
| `/claim <task description>` | Claims an existing unclaimed task (via autocomplete) or creates and claims a new one |
| `/tasks` | Shows current board state on demand |
| `/done <branch>` | Marks a task complete (autocompletes from currently claimed branches) |
| `/free <branch>` | Releases a claimed task back to unclaimed (autocompletes from currently claimed branches) |
| `/delete-task <branch>` | Deletes an unclaimed task from the board (autocompletes from currently unclaimed branches only — claimed/done tasks must be freed first) |

---

## Feature 2: Overlap Detection (on claim)

**Why:** directly prevents the incident that motivated this bot — two people building the same feature unknowingly.

**Behavior:**
- Only runs when `/claim` creates a **new** task (i.e. the description didn't match an existing unclaimed task via autocomplete) — claiming an already-existing unclaimed task skips this, since it was checked at creation time
- The new task description + all currently claimed task descriptions (within the same project) are sent to an LLM
- LLM is asked whether the new task overlaps with any existing one
- If a likely match is found, bot warns the user (doesn't block): *"Rifat is already working on 'user auth' — is this the same thing?"*
- User can confirm and proceed anyway if it's genuinely different

**Why LLM over embeddings for MVP:** task volume per project is small (10–20 tasks), so per-claim LLM latency/cost is negligible. No vector storage needed.

---

## Feature 3: Branch-as-Task-ID

**Why:** removes free-text ambiguity from `/done` and `/free`, and gives the GitHub integration a clean join key.

**Behavior:**
- On `/claim`, an LLM generates an appropriate branch name from the task description (e.g. `feature/user-auth`)
- This branch name becomes the task's permanent ID within the project
- Bot's claim confirmation includes a copy-pasteable command: `git checkout -b feature/user-auth`
- `/done` and `/free` become exact-match lookups against this ID — no fuzzy matching or LLM call needed
- Slash command autocomplete suggests currently claimed branch names as the user types

**Accepted failure mode:** if a member doesn't use the exact branch name, their pushes won't match any task — no scope-check runs for them, but nothing else breaks. Not worth building strict enforcement around for a short hackathon.

---

## Feature 4: Scope-Drift Detection (GitHub webhook)

**Why:** catches vibe-coding drift — someone claims "auth" but also touches unrelated files — without needing anyone to self-report.

**Behavior:**
- Bot subscribes to the `push` event on the project's linked repo (all branches)
- On every push, runs `compare(main, branch_head)` via the GitHub compare API
  - Deliberately **not** `before/after` diffing — that only shows the latest push's changes, not cumulative drift from the shared baseline, and it's fragile against force-pushes/rebases
- Branch name is matched against the claimed task ID (scoped to the correct project via the repo linked at project start)
- Diff (changed file names, ideally summarized) + claimed task description sent to an LLM to judge consistency
- If flagged as inconsistent, bot posts a nudge in the project's channel: *"Hey, your branch also touches `settings.tsx` and `db/schema.sql` — still just working on auth?"*
- No PR-based checking — the goal is saving time on tasks still in progress, not gating merges

**Webhook setup (MVP approach — manual):**
- A repo link alone isn't enough — GitHub only sends events to endpoints explicitly registered as webhooks on that repo
- On `/project start`, the bot generates a random secret (e.g. via `openssl rand -hex 32`) and stores it against the project (`Project.webhook_secret`)
- Bot displays the secret and instructs the repo owner to manually add a webhook: `Settings → Webhooks → Add webhook`, with the bot's endpoint as the Payload URL, content type `application/json`, the generated secret pasted into the Secret field, and the `push` event selected
- Considered but deferred: programmatic webhook registration via the GitHub API (`POST /repos/{owner}/{repo}/hooks`), which would need a Personal Access Token or a full GitHub App — more setup than justified for a hackathon-scoped tool

**Endpoint requirements:**
- The bot needs a public HTTPS endpoint to receive webhook POSTs (e.g. via a hosted service like Render/Railway/Fly.io, or `ngrok` during local development)
- Endpoint path should include the project identifier (e.g. `/webhooks/github/{project_id}`) so the correct project's secret can be looked up, since multiple projects/repos point at the same bot
- **Payload verification:** every incoming request must be validated before being trusted:
  1. Look up the project (and its stored secret) from the `{project_id}` in the URL
  2. Recompute an HMAC-SHA256 hash of the raw request body using that secret
  3. Compare against the `X-Hub-Signature-256` header GitHub sends
  4. Reject the request if they don't match — this prevents anyone who discovers the endpoint URL from spoofing fake push events

---

## Data Model

**Project**
- `channel_id` — scope of "active project" (primary scoping key)
- `guild_id` — used for admin permission checks and `/project list`
- `title`
- `github_repo`
- `webhook_secret` — random secret shared with GitHub's webhook config, used to verify incoming payloads
- `status` — `active` / `ended`
- `started_at` / `ended_at`
- `board_message_id`

**Task**
- `branch_id` (string) — e.g. `feature/user-auth`, unique within a project
- `project_id` (foreign key)
- `description`
- `owner` (Discord user ID, nullable if unclaimed)
- `status` — `unclaimed` / `claimed` / `done`
- `claimed_at`

**Persistence: SQLite.** Since this is a personal-use bot expected to run continuously across many hackathons over months, in-memory/flat-JSON storage isn't viable — data must survive restarts, deploys, and crashes without manual cleanup. SQLite is the right fit here: single file, zero separate server/infra to run, trivial backup (just copy the file), and comfortably handles this bot's write volume (claims, frees, done-marks, webhook events — nowhere near SQLite's limits). A library like `better-sqlite3` (Node) keeps this simple and synchronous. Revisit only if the bot ever needs to run across multiple server instances concurrently, which isn't the case for a single personal deployment.

---

## v2 (explicitly deferred)
- `/link-github` — maps Discord identity → GitHub username; lets the bot verify the person pushing to a branch is actually its claimant (catches silent handoffs / unannounced help)
- Periodic "what are you working on right now" check-in pings
- Auto-generated task breakdown from a one-line project description
- Due dates, priorities, dependencies, kanban-style views

---

## Build Order
1. Project lifecycle (`/project start/end/status/list`) with channel-scoped gating — nothing else works without this
2. Claim board + `/claim`, `/tasks`, `/done`, `/free` with branch-name-as-ID
3. LLM overlap check on `/claim`
4. GitHub webhook → `compare(main, branch)` → LLM drift check → channel nudge
5. Polish: autocomplete, embed formatting, edge cases (pushes on unclaimed/mismatched branch names)