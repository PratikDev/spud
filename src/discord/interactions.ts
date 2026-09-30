// Phase 1 of the Vercel migration — the actual transport swap.
//
// Discord POSTs every slash command / autocomplete / modal submit here instead
// of delivering them over a Gateway WebSocket. Every request MUST be verified
// with Ed25519 against the app's public key, over the RAW (unparsed) body.
//
// DO NOT simplify or relax this check. Discord periodically re-tests this
// endpoint with deliberately invalid signatures — including after it's been
// working correctly for a while — and will silently disable the Interactions
// Endpoint URL (with an email/DM to the app owner) the moment verification
// ever accepts something it shouldn't. A regression here isn't a bug that
// shows up in normal testing; it shows up as the bot silently going dark.
//
// Deliberately standalone for now (reads `DISCORD_PUBLIC_KEY` directly from
// `process.env`, not through `@/env`) — same reasoning as Phase 0's debug
// routes: this route is being proven in isolation, before it's wired to the
// rest of the app's env vars or command dispatch (that's Phase 2+).
//
// See notes/plan-vercel-migration.md, "Phase 1 — Discord transport swap".
// Command dispatch (Phase 2) added below — see "Phase 2 — Interaction
// compatibility shim + first command end-to-end".

import { InteractionResponseType, InteractionType, verifyKey } from "discord-interactions";

import { commands } from "@/discord/commands";
import type { RawInteraction } from "@/discord/interaction-shim";
import { createInteractionShim } from "@/discord/interaction-shim";
import { createLogger } from "@/logger";

const log = createLogger("discord/interactions");

const APPLICATION_COMMAND = 2;
const EPHEMERAL = 64;

async function dispatchCommand(raw: RawInteraction): Promise<Response> {
  const command = commands.find((c) => c.data.name === raw.data?.name);
  if (!command) {
    log.error("Unknown command in interaction", { name: raw.data?.name });
    return Response.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: "Unknown command.", flags: EPHEMERAL },
    });
  }

  let ackBody: { type: number; data?: Record<string, unknown> } | undefined;
  const shim = createInteractionShim(raw, (body) => {
    ackBody = body;
  });

  try {
    await command.execute(shim);
  } catch (error) {
    log.error("Command execution failed", { name: raw.data?.name, error });
    if (!ackBody) {
      return Response.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: { content: "Something went wrong running that command.", flags: EPHEMERAL },
      });
    }
    // Already acknowledged (reply/deferReply sent) before the failure — the
    // HTTP response below still has to carry that ack; nothing more we can
    // synchronously surface to Discord for an error past that point.
  }

  if (!ackBody) {
    log.error("Command never acknowledged the interaction", { name: raw.data?.name });
    return Response.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content: "Command did not respond.", flags: EPHEMERAL },
    });
  }

  return Response.json(ackBody);
}

export async function handleInteractionsRequest(req: Request): Promise<Response> {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    return Response.json({ error: "DISCORD_PUBLIC_KEY not set" }, { status: 500 });
  }

  const signature = req.headers.get("x-signature-ed25519");
  const timestamp = req.headers.get("x-signature-timestamp");
  const rawBody = await req.text();

  if (!signature || !timestamp) {
    return new Response("Missing signature headers", { status: 401 });
  }

  const isValid = await verifyKey(rawBody, signature, timestamp, publicKey);
  if (!isValid) {
    return new Response("Invalid request signature", { status: 401 });
  }

  const interaction = JSON.parse(rawBody) as RawInteraction;

  if (interaction.type === InteractionType.PING) {
    return Response.json({ type: InteractionResponseType.PONG });
  }

  if (interaction.type === APPLICATION_COMMAND) {
    return dispatchCommand(interaction);
  }

  // Autocomplete / message component / modal submit — not wired yet (later
  // phases, as each command needing them gets ported).
  return new Response("OK", { status: 200 });
}
