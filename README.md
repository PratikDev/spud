# Spud

A Discord bot for hackathon task coordination — a live claim board that shows who's working on what, catches two people building the same feature before it happens, and nudges someone if their branch quietly drifts outside the task they claimed.

## Features

### Project Lifecycle

A project is scoped to a **channel**, not the whole server, so one Discord server can host multiple concurrent hackathons/teams without collision. No task command works until someone starts one.

| Command | Access | Description |
|---|---|---|
| `/project start <title> <github-repo>` | Anyone | Starts a new active project in this channel, links a GitHub repo, generates a webhook secret. Whoever runs it becomes the project's **team lead** |
| `/project configure [start-time] [end-time] [rulebook]` | Team lead only | Sets or updates the project's timeline (parsed from natural language via `chrono-node`, e.g. "July 25 9am") and rulebook file. Any subset of fields can be provided per call |
| `/project end` | Team lead only | Ends the active project, archives (doesn't delete) its board/task data, unpins the board |
| `/project status` | Team lead only | Shows the active project's title, repo, task counts, timeline, and rulebook link |
| `/project list` | Server admin | Lists all active projects across the server (bird's-eye view, ephemeral) |
| `/project set-gemini-key` | Team lead only | Opens a modal to set or remove this project's own Gemini API key, enabling/disabling AI features |

`/project start` is open to anyone — whoever runs it in a channel becomes that project's team lead, no `Administrator` permission required. `/project configure`, `/project end`, and `/project status` are then restricted to that specific Discord member — with **no admin override**. Only `/project list` requires Discord's `Administrator` permission, since it's a cross-channel, server-wide view. This mixed anyone/team-lead/admin model can't be expressed through Discord's per-command default-permission system (which applies to a whole command, not per-subcommand), so it's enforced in application code instead (see [authorization.ts](src/discord/authorization.ts)). A channel can only have one *active* project at a time, enforced at the database level (a partial unique index), not just in application code.

Team lead has no reassignment path yet — if the team lead leaves the server, `/project configure`/`end`/`status` become permanently unusable for that project (no admin fallback, no migration tool to patch it).

`/project start` only takes the bare minimum (title + repo); timeline and rulebook are set separately via `/project configure` since they might not be decided yet when the project is created. `/claim` refuses to run until both `start-time` and `end-time` are set. Timeline input is natural language (no timezone support — everything is parsed relative to the process's own local time), and the rulebook file is re-posted as a message in the project channel rather than storing the raw attachment URL, since Discord's CDN URLs carry a signed expiry but a message can always be re-fetched (or jumped to) for a fresh one.

### Claim Board

A pinned, auto-updating embed in the project's channel with three sections: 🟢 up for grabs, 🔧 in progress, ✅ done. It's created and pinned the moment `/project start` runs, and re-rendered on every claim/done/free/delete.

| Command | Description |
|---|---|
| `/claim <description>` | Claims an existing unclaimed task (autocompletes matching descriptions), or creates and claims a new one |
| `/tasks` | Shows the current board state on demand |
| `/done <branch>` | Marks a claimed task done (autocompletes claimed branches) |
| `/free <branch>` | Releases a claimed task back to unclaimed (autocompletes claimed branches) |
| `/delete <branch>` | Deletes a task of any status — unclaimed, claimed, or done (autocompletes across all branches) |

**Authorization:** `/done`, `/free`, and `/delete` only work for the task's current owner or a server admin — anyone else gets turned away. The one exception is deleting an *unclaimed* task, which has no owner to match against, so that specific case is admin-only.

### AI features (Gemini)

Overlap detection, branch naming, and scope-drift nudges (both described below) all run on Gemini — but Spud doesn't hold its own Gemini key. Each project supplies its own via `/project set-gemini-key`, collected through a Discord **modal** rather than a plain command option (a typed option's value shows up in the channel even with an ephemeral reply; a modal submission never does), and stored encrypted (see "Encryption at rest" below). Submitting an empty value clears it.

Without a key set, AI features are simply unavailable for that project rather than erroring — see each feature's fallback below.

### Overlap Detection + Branch Naming

When `/claim` is given free text that doesn't match an existing unclaimed task, it's treated as a brand-new task and a single Gemini call ([`llm/claim-analysis.ts`](src/llm/claim-analysis.ts)) does two things at once:

1. **Overlap check** — compares the new description against every other task's description on the board, regardless of status (unclaimed, claimed, or done). If it looks like a duplicate, the claim is **rejected** (not just warned) with a message naming the existing owner/task/branch and a nudge to retry with more detail.
2. **Branch naming** — generates a deterministic `type/kebab-slug` branch name (`feature`, `fix`, `chore`, `docs`, or `refactor`) from strict, ordered rules in a dedicated system prompt ([`llm/prompts/claim-analysis.ts`](src/llm/prompts/claim-analysis.ts)), so the same description always produces the same branch name. A collision-safety helper still appends `-2`, `-3`, etc. if two different descriptions land on the same slug.

Claiming an *existing* unclaimed task skips all of this — no LLM call, no new branch, since it was already checked when the task was first created.

**No Gemini key configured:** no overlap check at all, and a plain `task/kebab-slug` branch name instead ([`utils/slugify.ts`](src/utils/slugify.ts), no type guessing) — with a one-time note in `/claim`'s reply pointing at `/project set-gemini-key`.

### Scope-Drift Detection (GitHub webhook)

Catches "vibe coding" drift — claiming "auth" but also touching unrelated files — without anyone self-reporting.

- On `/project start`, the repo's default branch (not a hardcoded `main` — plenty of repos still use `master`) is fetched once and cached on the project row, and a webhook secret is generated and shown to the team lead (ephemeral, once) along with the payload URL, content type, and which events to select in GitHub's **Settings → Webhooks → Add webhook**.
- On every `push` whose branch isn't the cached default branch, the bot diffs it against that default branch via GitHub's compare API — pushes to the default branch itself are ignored before any database lookup, since they can never be a task's working branch.
- If the branch matches a currently-*claimed* task **and the project has a Gemini key configured**, the changed files + task description go to Gemini ([`llm/drift.ts`](src/llm/drift.ts)), which judges whether the diff still looks consistent with the task — biased toward not flagging, since a false alarm costs more trust than a missed one. No key configured means the drift check is silently skipped — before the GitHub compare-API call even happens, not just before the Gemini call.
- If flagged, the bot posts a nudge in the project's channel naming the unexpected files.
- On the webhook's first `ping` event (sent automatically when GitHub adds the hook), the bot posts a one-time confirmation in the channel that the integration is live.
- Pushes on a branch with no matching claimed task are silently ignored — nothing breaks, it just doesn't get scope-checked.
- GitHub API calls use a short-lived installation token when Spud's [GitHub App](#github-app-authentication) is installed on the repo — including for private repos. Otherwise they fall back to unauthenticated calls, which only work on public repos.
- Every webhook request is rate-limited per project (token bucket, 20-request burst, refills at 1/3s) after signature verification — once exhausted, further requests get a `429` until it refills. Outbound GitHub compare-API and Gemini calls are also timeboxed (10s and 15s respectively) so a hung request can't stall the handler indefinitely.

### Auto-close on merge (GitHub webhook)

- On a `pull_request` event with `action: closed` and `merged: true`, the bot reads the merged branch straight off the payload (`pull_request.head.ref`) — no extra API call needed.
- If that branch matches a currently-*claimed* task, the task is marked done automatically and the board updates, with a confirmation posted in the channel naming the PR.
- **Only detects merges done through GitHub's own merge/squash/rebase button** (i.e. via a pull request). A team that merges locally and pushes straight to the default branch won't trigger this — that push is a default-branch push, which is deliberately ignored (see above).

### Encryption at rest

The webhook secret and each project's Gemini API key are stored encrypted (AES-256-GCM, [`crypto.ts`](src/crypto.ts)), keyed by a server-side `ENCRYPTION_KEY` env var — not by the database's own storage layer, so this holds regardless of what the underlying host provides. Both are decrypted only at the point of use (HMAC comparison, the Gemini call) and are never written to logs.

### GitHub App authentication

Spud registers as a [GitHub App](https://github.com/apps/spud-discord-bot) with read-only **Contents** + **Metadata** permissions, so it can be installed on private repos rather than requiring every linked repo to be public.

- No OAuth, no stored user tokens — [`github/app-auth.ts`](src/github/app-auth.ts) signs a short-lived (10 min) JWT as the App itself (RS256 via Node/Bun's built-in `crypto`, no JWT library), uses it to look up whether the App is installed on a given repo, and — if so — mints a 1-hour installation access token scoped to exactly those two permissions.
- A fresh token is minted right before each use (`/project start`, and every drift-checking push) rather than cached, since installation tokens expire in an hour and pushes can land long after any earlier token would have.
- If the App **isn't** installed on the linked repo, everything falls back to the previous unauthenticated behavior — public repos keep working exactly as before, and `/project start`'s replies include the install link so the team lead can add private-repo support without re-running the command.
- No installation↔repo mapping is persisted anywhere — installation status is resolved fresh on every call instead, since the lookup is a single cheap API call and this avoids ever going stale (e.g. after someone uninstalls the App).

## Architecture

Everything runs as a **single Bun process** — the Discord gateway client and the webhook HTTP server both start from [`index.ts`](index.ts) and share the same SQLite database.

```mermaid
flowchart LR
    Team["Team members"] <--> Discord["Discord"]
    Discord <--> Spud["Spud\n(single Bun process)"]
    Spud <--> DB[("SQLite")]
    Spud <--> Gemini["Gemini"]
    GitHub["GitHub"] -->|push / pull_request / ping webhook| Spud
    Spud -->|compare API| GitHub
```

**Webhook request flow** in more detail — this is the part with the most moving pieces:

```mermaid
sequenceDiagram
    participant GH as GitHub
    participant HTTP as Bun.serve
    participant DB as SQLite
    participant API as GitHub REST API
    participant LLM as Gemini
    participant Discord as Project channel

    GH->>HTTP: POST /webhooks/github/:projectId (X-Hub-Signature-256)
    HTTP->>DB: look up project + webhook_secret
    HTTP->>HTTP: verify HMAC-SHA256 (constant-time)
    alt signature invalid
        HTTP-->>GH: 401
    else rate limit exhausted (per project)
        HTTP-->>GH: 429
    else ping event
        HTTP-->>GH: 200
        HTTP->>Discord: "webhook connected successfully"
    else push event
        alt branch is the cached default branch
            HTTP-->>GH: 200 (no-op, no DB lookup)
        else
            HTTP->>DB: find claimed task by branch name
            alt no matching claimed task
                HTTP-->>GH: 200 (no-op)
            else task found
                alt no Gemini key configured for project
                    HTTP-->>GH: 200 (drift check skipped, no compare call)
                else
                    HTTP->>API: compare(cached default branch, branch)
                    HTTP->>LLM: task description + changed files -> isDrifted?
                    alt drifted
                        HTTP->>Discord: nudge naming the unexpected files
                    end
                    HTTP-->>GH: 200
                end
            end
        end
    else pull_request event (closed + merged)
        HTTP->>DB: find claimed task by merged branch name
        alt task found
            HTTP->>DB: mark task done
            HTTP->>Discord: board update + merge confirmation
        end
        HTTP-->>GH: 200
    end
```

## Tech stack

| Concern | Choice |
|---|---|
| Runtime | [Bun](https://bun.com) |
| Discord | `discord.js` v14 |
| Database | `@libsql/client` — [Turso](https://turso.tech) when `TURSO_DATABASE_URL` is set, a local SQLite file otherwise |
| Webhook HTTP server | `Bun.serve` (built-in — no Express/Hono) |
| LLM | `ai` (Vercel AI SDK) + `@ai-sdk/google`, Gemini |
| GitHub API | raw `fetch` (no `octokit`); GitHub App JWT auth via built-in `crypto` (no JWT library) |
| HMAC verification + encryption at rest | Node/Bun built-in `crypto` |
| Validation | `zod` |
| Date parsing | `chrono-node` (natural-language timeline input for `/project configure`) |
| Logging | `winston` + `winston-loki`, optionally shipping to Grafana Cloud Loki |

Net dependencies: `discord.js`, `ai`, `@ai-sdk/google`, `@libsql/client`, `zod`, `chrono-node`, `winston`, `winston-loki` — everything else rides on what Bun ships with.

## Local setup

**Prerequisites:**
- [Bun](https://bun.com) installed
- A Discord application + bot ([Developer Portal](https://discord.com/developers/applications)) — see below if you haven't made one
- A GitHub App ([github.com/settings/apps](https://github.com/settings/apps)) — see below if you haven't made one
- Optional: a free Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) — only needed per-project, via `/project set-gemini-key`, to enable AI features (see "AI features (Gemini)" above)

**1. Install dependencies**

```bash
bun install
```

**2. Configure environment**

```bash
cp .env.example .env
```

| Variable | Required | Notes |
|---|---|---|
| `DISCORD_TOKEN` | yes | Bot token, from the Developer Portal's **Bot** page |
| `DISCORD_CLIENT_ID` | yes | Application ID, from **General Information** |
| `GEMINI_MODEL_NAME` | yes | e.g. `gemini-3.1-flash-lite` — the model Spud calls; each project's own key (see "AI features (Gemini)" above) authenticates the call |
| `ENCRYPTION_KEY` | yes | Base64-encoded 32-byte key for AES-256-GCM, used to encrypt `webhook_secret` and `gemini_api_key` at rest. Generate with `openssl rand -base64 32` |
| `GITHUB_APP_ID` | yes | From your [GitHub App](https://github.com/settings/apps)'s settings page |
| `GITHUB_APP_SLUG` | yes | From the App's public page URL: `github.com/apps/<slug>` |
| `GITHUB_APP_PRIVATE_KEY` | yes | The App's private key `.pem`, pasted as-is — quote it in `.env` so the real newlines survive (Render's env var UI accepts multi-line values directly, no encoding needed either) |
| `PORT` | no | Webhook server port, defaults to `3000` |
| `PUBLIC_BASE_URL` | no | Shown in `/project start`'s webhook setup message; without it you just get the raw path |
| `TURSO_DATABASE_URL` | no | Hosted [Turso](https://turso.tech) database URL. Without it, falls back to a local SQLite file |
| `TURSO_AUTH_TOKEN` | no | Turso auth token — must be a **database** token (`turso db tokens create <db-name>`), not an account-level API token |
| `DATABASE_PATH` | no | Local SQLite file path, only used when `TURSO_DATABASE_URL` is unset. Defaults to `spud.sqlite` |
| `LOG_LEVEL` | no | Minimum level to emit (`debug`/`info`/`warn`/`error`). Defaults to `info` |
| `LOKI_HOST` | no | Grafana Cloud Loki instance URL (bare, no path — same as the data source's "Connection URL"). Logs ship to Loki only if this and the next two are all set |
| `USER_ID` | no | Grafana Cloud Loki numeric instance/user ID |
| `GRAFANA_CLOUD_TOKEN` | no | Grafana Cloud API token with Loki write access |

**3. Create and invite the bot** (skip if you already have one in your server)

1. [Developer Portal](https://discord.com/developers/applications) → **New Application**
2. **Bot** page → copy the token into `DISCORD_TOKEN`
3. **General Information** → copy the Application ID into `DISCORD_CLIENT_ID`
4. **OAuth2 → URL Generator** → scopes `bot` + `applications.commands`; permissions `Send Messages` and `Manage Messages` (needed to pin/unpin the board) → open the generated URL and invite it to your server

**4. Create the GitHub App** (skip if you already have one)

1. [github.com/settings/apps](https://github.com/settings/apps) → **New GitHub App**
2. Uncheck "Active" under Webhook (Spud doesn't need the App's own webhook — see "GitHub App authentication" above)
3. **Permissions → Repository permissions** → set **Contents: Read-only** and **Metadata: Read-only** (nothing else)
4. Create the App, then copy its **App ID** into `GITHUB_APP_ID` and the slug from its URL (`github.com/apps/<slug>`) into `GITHUB_APP_SLUG`
5. **Generate a private key** on the same page → paste its contents as-is into `GITHUB_APP_PRIVATE_KEY` (quoted in `.env`)
6. **Install App** on whichever account/repos you want Spud to access

**5. Register slash commands and run**

```bash
bun run register-commands   # push commands to Discord (re-run after changing any command's shape)
bun run dev                 # or `bun run start` without file-watching
```

Try `/project start` in a channel (anyone can run it — no admin permission needed), then `/claim`. Run `/project set-gemini-key` beforehand if you want overlap detection and drift nudges — it's optional, everything else works without it.

**Testing the GitHub webhook locally:** point `ngrok` (or similar) at your `PORT`, set `PUBLIC_BASE_URL` to the ngrok URL, and use the payload URL `/project start` gives you when adding the webhook on a public repo.

## Running with Docker

The [Dockerfile](Dockerfile) runs the app via `bun run index.ts` on top of a normal `bun install --production`, rather than compiling a standalone binary — `@libsql/client` loads a platform-specific native binding at runtime (e.g. `@libsql/linux-x64-musl`), resolved dynamically rather than via a static import, which `bun build --compile` can't bundle into a single executable. Without `TURSO_DATABASE_URL` set, the app falls back to a local SQLite file inside the container's own writable layer, lost on every restart; set `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` (see the env var table above) for real persistence via a hosted Turso database instead.

```bash
make build   # docker build -t spud .
make run     # docker run --env-file .env -p 3000:3000 --name spud -d spud
make logs    # docker logs -f spud
make stop    # docker stop spud
make start   # docker start spud
make rm      # docker rm -f spud
```

Note: `.env` values must be unquoted for `--env-file` to parse them correctly (Bun's own loader strips quotes, Docker's doesn't).

## Known limitations

- **No data persistence without Turso configured** — without `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` set, the app falls back to a local SQLite file inside the container's own writable layer, wiped on every restart or redeploy. Set those two env vars to persist real data in a hosted Turso database instead (see "Running with Docker").
- **Private repos need the GitHub App installed** — without it, GitHub API calls fall back to unauthenticated (public repos only, and subject to GitHub's 60 requests/hour unauthenticated rate limit). See "GitHub App authentication" above.
- **Overlap detection can reject legitimate claims** — it's an LLM judgment call with no manual override; if it wrongly flags a genuinely different task as a duplicate, your only recourse is retrying `/claim` with a more detailed description.
- **Branch names must match exactly** — `/done`, `/free`, `/delete`, and drift-checking all key off the exact branch name the bot generated. Push to a differently-named branch and it's silently never scope-checked — by design, not a crash.
- **Single instance only** — one Discord gateway connection per process, and no request/session state is shareable across replicas; this isn't built to run as multiple instances behind a load balancer. Webhook rate limiting is also in-memory, so it resets on every restart and isn't shared across replicas.
- **No schema migrations** — schema changes are hand-written `CREATE TABLE`/column edits with no migration tool. Given the "OK to lose data" stance that's intentional, but existing rows won't pick up new columns without a fresh database.
- **No multi-timezone support** — `/project configure`'s natural-language timeline input (via `chrono-node`) is always parsed as Bangladesh Standard Time (UTC+6), regardless of who's typing or where the bot runs. Fine for a single BD-based team, not for a distributed one.
- **Team lead has no reassignment path** — `/project configure`, `/project end`, and `/project status` are gated to the team lead (whoever ran `/project start`) with no admin override. If that person leaves the server, those subcommands become permanently unusable for that project — there's no command to reassign team lead and no migration tool to patch the `team_lead` column by hand.
- **Default branch is cached, not re-checked** — the repo's default branch is fetched once at `/project start` and reused for every push/drift comparison after that. If the repo's default branch is renamed later (e.g. `master` → `main`), the project won't notice — the only fix is ending and restarting the project.
- **AI features are silently opt-in** — a project with no Gemini key set via `/project set-gemini-key` gets no overlap detection (just a plain slug branch name) and no drift nudges, with only a one-time note in `/claim`'s reply — there's no periodic reminder that AI features are off.
