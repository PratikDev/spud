// Vercel entry point — one Bun.serve() call, same routing pattern
// src/github/webhook.ts already uses today (see notes/plan-vercel-migration.md).
//
// IMPORTANT: keep `api/` down to routing entry points only. Vercel's Bun
// runtime auto-discovers every .ts file under `api/` as its own independent
// Function based on file location alone — a plain helper module living here
// (not exporting a function/Bun.serve()) fails to deploy with "Invalid
// export found". All real logic lives under `src/` and gets imported here.

import { handleInteractionsRequest } from "@/discord/interactions";

Bun.serve({
  routes: {
    "/api/health": new Response("OK"),
    "/api/discord/interactions": {
      POST: handleInteractionsRequest,
    },
  },
});
