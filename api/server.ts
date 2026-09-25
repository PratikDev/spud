// Vercel entry point — one Bun.serve() call, same routing pattern
// src/github/webhook.ts already uses today (see notes/plan-vercel-migration.md).
//
// Phase 0 validated `@libsql/client` and `winston`/`winston-loki` both work
// inside a Vercel Bun Function against real Turso/Grafana credentials — the
// temporary /api/_debug/* routes that proved that have been removed.
//
// IMPORTANT: keep `api/` down to routing entry points only. Vercel's Bun
// runtime auto-discovers every .ts file under `api/` as its own independent
// Function based on file location alone — a plain helper module living here
// (not exporting a function/Bun.serve()) fails to deploy with "Invalid
// export found". All real logic lives under `src/` and gets imported here.
//
// IMPORTANT: import from `src/` using a RELATIVE path, not the `@/*` alias.
// The alias deploys fine but crashes at runtime with "bun is unable to write
// files: ReadOnlyFileSystem" — Bun's module resolver appears to need to write
// a resolution cache to satisfy the alias, and Vercel Functions don't allow
// filesystem writes outside /tmp. Confirmed by direct A/B test against this
// exact file: `@/discord/interactions` crashed, `../src/discord/interactions`
// didn't. This applies to every future phase's imports into `api/server.ts`.

import { handleInteractionsRequest } from "../src/discord/interactions";

Bun.serve({
  routes: {
    "/api/health": new Response("OK"),
    "/api/discord/interactions": {
      POST: handleInteractionsRequest,
    },
  },
});
