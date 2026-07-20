# Development Plan — Spud

Companion to [prd.md](./prd.md). Stack choices below are picked to minimize dependencies — favoring what Bun already ships with over adding a package.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Bun (already scaffolded) | single binary, fast startup, native TS |
| Discord | `discord.js` v14 | only real option for slash commands + autocomplete; well-supported on Bun |
| Database | `bun:sqlite` (built into Bun) | PRD calls for SQLite via `better-sqlite3` — Bun ships an equivalent SQLite driver natively, so that's one fewer dependency for the same synchronous API |
| Webhook HTTP server | `Bun.serve` (built-in) | one endpoint (`POST /webhooks/github/:project_id`); doesn't need Express/Hono |
| LLM calls (claim analysis, drift) | `ai` (Vercel AI SDK) + `@ai-sdk/google`, Gemini model (e.g. `gemini-2.0-flash`) | free-tier API key; `generateObject` from `ai` gives structured output without hand-rolling Gemini's REST schema. Overlap check + branch-name generation are combined into a single `generateObject` call on `/claim` (one prompt, one round trip, returns `{ overlappingTask, branchName }`) rather than two separate calls |
| GitHub API (compare endpoint) | raw `fetch` with a PAT | one GET call (`/repos/{owner}/{repo}/compare/{base}...{head}`); no need for `octokit` |
| HMAC verification | Node/Bun built-in `crypto` | webhook signature check, no dependency |
| Env vars | Bun's automatic `.env` loading | no `dotenv` package needed |

**Net new dependencies: `discord.js`, `ai`, `@ai-sdk/google`.** Everything else rides on what Bun already provides.

## Project structure

```
index.ts                    # entrypoint: init db, login discord client, start webhook server
src/
  db.ts                     # schema init (CREATE TABLE IF NOT EXISTS) + typed query helpers
  types.ts                  # Project, Task types
  discord/
    client.ts               # Client construction, command registration, event wiring
    commands/
      project.ts             # /project start|end|status|list
      claim.ts                # /claim, /tasks, /done, /free, /delete-task (+ autocomplete)
    board.ts                 # renders/updates the pinned board embed
  llm/
    client.ts                # shared Gemini model instance (`ai-sdk`'s `google(...)`)
    claim-analysis.ts         # Features 2+3 combined: one `generateObject` call returns { overlappingTask, branchName }
    drift.ts                  # Feature 4: drift-consistency call
    prompts/
      claim-analysis.ts        # system prompt for claim-analysis.ts
      drift.ts                  # system prompt for drift.ts
  github/
    verify.ts                  # HMAC-SHA256 signature check against a project's webhook_secret
    compare.ts                  # fetch wrapper: default-branch lookup + compare(default, branch)
    webhook.ts                  # Bun.serve request handler: route, verify, look up task, judge drift, nudge
```

Flat and small enough that no framework (no NestJS, no command-handler library) is justified — discord.js's own `SlashCommandBuilder` + a manual `switch`/map on command name is enough at this command count (~9 commands total).

## Data model

Matches the PRD directly — two tables, `projects` and `tasks`, created via `bun:sqlite`'s `Database.exec` at boot. No migration tool (Prisma/Drizzle) needed for two tables that won't change shape often; hand-written `ALTER TABLE` statements are fine if the schema evolves.

## Environment variables

- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` — bot login + slash command registration
- `GOOGLE_GENERATIVE_AI_API_KEY` — overlap/branch-name/drift LLM calls (Gemini, free-tier key from Google AI Studio)
- `GITHUB_TOKEN` — PAT with `repo` scope, for the compare API (optional: needed for private repos and to avoid the 60 req/hr unauthenticated rate limit; public repos work without it)
- `PORT` — for `Bun.serve` (defaults to `3000` if unset, same pattern as `DATABASE_PATH`'s default)
- `PUBLIC_BASE_URL` — printed to admins when setting up the GitHub webhook (e.g. `https://your-host/webhooks/github/{project_id}`); optional — if unset, `/project start` just shows the path and asks the admin to prepend their own host

## Milestones

Mirrors the PRD's Build Order, made concrete:

1. **Bootstrap** — `bun add discord.js ai @ai-sdk/google`; `src/db.ts` schema; discord client login + slash command registration script; env loading. Nothing user-facing yet, just "the bot comes online."
2. **Feature 0 — Project lifecycle** — `/project start/end/status/list`, `Administrator`-permission gate, channel-scoped active-project lookup. Everything downstream depends on this existing.
3. **Feature 1 — Claim board** — `tasks` table CRUD, pinned embed render/update (`board.ts`), `/claim` (new-task path stubbed, no LLM yet), `/tasks`, `/done`, `/free`, `/delete-task`, autocomplete wiring.
4. **Feature 2 + 3 — Overlap check + branch naming** — both trigger on the exact same `/claim`-creates-new-task code path, so build as one LLM call: `llm/client.ts` (Gemini model setup), `claim-analysis.ts` (single `generateObject` call, schema `{ overlappingTask: string | null, branchName: string }`, input = new description + list of claimed descriptions), confirm/override interaction (Discord button or re-invoke) for the overlap warning.
5. **Feature 4 — GitHub webhook** — see breakdown below.
6. **Polish** — autocomplete edge cases (empty board, >25 results), embed formatting pass, handling pushes on branches with no matching task.

### Milestone 5 detail — GitHub webhook

**Request flow** (`POST /webhooks/github/:projectId`, handled in `github/webhook.ts`, run via `Bun.serve` alongside the discord.js client in the same process):

1. Read the raw request body as text first — HMAC must be computed over the exact raw bytes, before any JSON parsing.
2. Look up the project by the `:projectId` path param.
   - Not found → `404`.
   - Found but `status !== 'active'` → `200` no-op (an ended project's webhook wasn't necessarily removed from GitHub; we shouldn't make GitHub think the endpoint is broken by erroring on stray traffic).
3. Verify `X-Hub-Signature-256` — recompute HMAC-SHA256 of the raw body using the project's stored `webhook_secret` (`github/verify.ts`), constant-time compare. Mismatch → `401`.
4. Parse the body as JSON. If `X-GitHub-Event: ping` (GitHub's test event sent when the webhook is first added) → `200` immediately, no further processing.
5. For a `push` event: take `ref` (e.g. `refs/heads/feature/add-auth`), strip the `refs/heads/` prefix to get the branch name.
6. Look up a **claimed** task in this project with that exact `branch_id`.
   - No match (unclaimed, done, or a branch name nobody's task uses) → `200` no-op. This is the PRD's accepted failure mode: pushes on a mismatched branch name just don't get scope-checked, nothing else breaks.
7. Call the GitHub compare API (`github/compare.ts`):
   - First fetch the repo's default branch (`GET /repos/{owner}/{repo}`) rather than assuming `main` — plenty of repos still default to `master` or something else, and this avoids a wrong/stale value in the DB with no extra schema. One more API call per push is negligible.
   - Then `GET /repos/{owner}/{repo}/compare/{default_branch}...{branch}`, pull `files[].filename` (+ `status`/`additions`/`deletions` if worth summarizing) from the response.
8. Send the changed-file list + the claimed task's `description` to Gemini (`llm/drift.ts`, system prompt in `llm/prompts/drift.ts`) asking whether the diff looks consistent with the task description.
9. If flagged inconsistent, post the nudge in `project.channel_id` using the shared discord.js `client` singleton (this handler isn't triggered by a Discord interaction, so unlike the command files it can't borrow `interaction.client` — it imports `client` from `@/discord/client` directly, which is safe here since `webhook.ts` isn't part of the command-registry import chain that caused the earlier circular-import concern).
10. Always respond `200` to GitHub once verification passes, regardless of whether a nudge was posted — GitHub treats non-2xx as a delivery failure and will retry/flag the webhook as unhealthy.

**Loose end from milestone 2:** `/project start`'s existing ephemeral follow-up already generates and shows `webhook_secret`, but couldn't show a real payload URL yet since the endpoint didn't exist. This milestone updates that message to include the actual `POST {PUBLIC_BASE_URL}/webhooks/github/{project_id}` URL (or just the path, with a note to prepend their own host, if `PUBLIC_BASE_URL` isn't set) alongside the secret and the `push`-event/`application/json` instructions.

**Testing without a live public endpoint:** `github/verify.ts` gets a plain unit-style check (known secret + body → known signature). The full handler gets exercised by POSTing to the local `Bun.serve` instance directly with a manually HMAC-signed payload (computed the same way GitHub would), which covers routing, signature verification, task lookup, and the drift LLM call end-to-end without needing `ngrok` or a real GitHub webhook for every iteration. `github/compare.ts` can be checked against a real small public repo's compare API directly, since it needs no auth for that.

## Deployment

Single Bun process runs both the discord.js client and the `Bun.serve` webhook listener — one `index.ts`, one deploy target (Railway/Fly.io/Render, small instance). SQLite file lives on a persistent volume/disk; back up by copying the file. Local dev uses `ngrok` (or similar) to expose the webhook endpoint to GitHub.
