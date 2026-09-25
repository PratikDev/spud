// Vercel entry point — one Bun.serve() call, same routing pattern
// src/github/webhook.ts already uses today (see notes/plan-vercel-migration.md).
//
// Phase 0 validated `@libsql/client` and `winston`/`winston-loki` both work
// inside a Vercel Bun Function against real Turso/Grafana credentials — the
// temporary /api/_debug/* routes that proved that have been removed.

Bun.serve({
  routes: {
    "/api/health": new Response("OK"),
  },
});
