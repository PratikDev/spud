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
    drift.ts                  # Feature 4: drift-consistency prompt
  github/
    compare.ts                 # fetch wrapper for GitHub compare API
    webhook.ts                  # Bun.serve request handler + HMAC verification
```

Flat and small enough that no framework (no NestJS, no command-handler library) is justified — discord.js's own `SlashCommandBuilder` + a manual `switch`/map on command name is enough at this command count (~9 commands total).

## Data model

Matches the PRD directly — two tables, `projects` and `tasks`, created via `bun:sqlite`'s `Database.exec` at boot. No migration tool (Prisma/Drizzle) needed for two tables that won't change shape often; hand-written `ALTER TABLE` statements are fine if the schema evolves.

## Environment variables

- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` — bot login + slash command registration
- `GOOGLE_GENERATIVE_AI_API_KEY` — overlap/branch-name/drift LLM calls (Gemini, free-tier key from Google AI Studio)
- `GITHUB_TOKEN` — PAT with `repo` scope, for the compare API (needed for private repos; public repos work unauthenticated but rate-limited)
- `PORT` — for `Bun.serve` (webhook endpoint)
- `PUBLIC_BASE_URL` — printed to admins when setting up the GitHub webhook (e.g. `https://your-host/webhooks/github/{project_id}`)

## Milestones

Mirrors the PRD's Build Order, made concrete:

1. **Bootstrap** — `bun add discord.js ai @ai-sdk/google`; `src/db.ts` schema; discord client login + slash command registration script; env loading. Nothing user-facing yet, just "the bot comes online."
2. **Feature 0 — Project lifecycle** — `/project start/end/status/list`, `Administrator`-permission gate, channel-scoped active-project lookup. Everything downstream depends on this existing.
3. **Feature 1 — Claim board** — `tasks` table CRUD, pinned embed render/update (`board.ts`), `/claim` (new-task path stubbed, no LLM yet), `/tasks`, `/done`, `/free`, `/delete-task`, autocomplete wiring.
4. **Feature 2 + 3 — Overlap check + branch naming** — both trigger on the exact same `/claim`-creates-new-task code path, so build as one LLM call: `llm/client.ts` (Gemini model setup), `claim-analysis.ts` (single `generateObject` call, schema `{ overlappingTask: string | null, branchName: string }`, input = new description + list of claimed descriptions), confirm/override interaction (Discord button or re-invoke) for the overlap warning.
5. **Feature 4 — GitHub webhook** — `Bun.serve` route, HMAC-SHA256 verification against stored `webhook_secret`, `github/compare.ts`, `llm/drift.ts`, nudge message post. Webhook secret generation moves into `/project start` from milestone 2.
6. **Polish** — autocomplete edge cases (empty board, >25 results), embed formatting pass, handling pushes on branches with no matching task.

## Deployment

Single Bun process runs both the discord.js client and the `Bun.serve` webhook listener — one `index.ts`, one deploy target (Railway/Fly.io/Render, small instance). SQLite file lives on a persistent volume/disk; back up by copying the file. Local dev uses `ngrok` (or similar) to expose the webhook endpoint to GitHub.
