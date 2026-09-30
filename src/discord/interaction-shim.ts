// Phase 2 of the Vercel migration — the interaction compatibility shim.
//
// Command files (src/discord/commands/*) are written against discord.js's
// real ChatInputCommandInteraction, built for the Gateway world where the
// library owns a live connection and every reply is just a REST call. Over
// HTTP interactions there's no such connection — the FIRST reply has to be
// embedded in the HTTP response we send back to Discord's own POST, and only
// later replies (deferReply -> editReply/followUp) go over REST. This module
// is what lets command files stay completely unmodified: it wraps the raw
// interaction JSON + Discord's webhook REST endpoints behind the same method
// names/shapes they already call.
//
// See notes/plan-vercel-migration.md, "Phase 2 — Interaction compatibility
// shim + first command end-to-end".

import type { ChatInputCommandInteraction } from "discord.js";

const DISCORD_API = "https://discord.com/api/v10";

// Only the fields the shim itself reads — not Discord's full interaction
// schema. Extend as later commands need more (e.g. resolved data for
// mentions/attachments).
export interface RawInteraction {
  id: string;
  token: string;
  application_id: string;
  type: number;
  guild_id?: string;
  channel_id?: string;
  member?: { user: { id: string } };
  user?: { id: string };
  data?: {
    name: string;
    options?: RawOption[];
  };
}

interface RawOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: RawOption[];
}

// discord.js option/subcommand type IDs (Discord's API, not a discord.js
// export we can import standalone) — only the ones commands actually use.
const OPTION_TYPE_SUBCOMMAND = 1;

function toRestPayload(options: unknown): Record<string, unknown> {
  if (typeof options === "string") return { content: options };
  const opts = (options ?? {}) as Record<string, unknown>;
  const body: Record<string, unknown> = {};
  if (opts.content !== undefined) body.content = opts.content;
  if (opts.flags !== undefined) body.flags = opts.flags;
  if (Array.isArray(opts.embeds)) {
    body.embeds = opts.embeds.map((embed) => (hasToJSON(embed) ? embed.toJSON() : embed));
  }
  if (Array.isArray(opts.components)) {
    body.components = opts.components.map((component) => (hasToJSON(component) ? component.toJSON() : component));
  }
  return body;
}

function hasToJSON(value: unknown): value is { toJSON(): unknown } {
  return typeof value === "object" && value !== null && typeof (value as { toJSON?: unknown }).toJSON === "function";
}

// The first ack (reply/deferReply) MUST be the interactions endpoint's HTTP
// response body itself — Discord has no other way to receive it. `deliver`
// hands that body back to the caller (src/discord/interactions.ts), which
// returns it as the actual Response.
export function createInteractionShim(
  raw: RawInteraction,
  deliver: (body: { type: number; data?: Record<string, unknown> }) => void,
): ChatInputCommandInteraction {
  let acknowledged = false;
  const webhookBase = `${DISCORD_API}/webhooks/${raw.application_id}/${raw.token}`;

  function requireNotAcknowledged() {
    if (acknowledged) {
      throw new Error("Interaction already acknowledged (reply/deferReply called more than once)");
    }
    acknowledged = true;
  }

  const shim = {
    guildId: raw.guild_id ?? null,
    channelId: raw.channel_id,
    user: { id: raw.member?.user.id ?? raw.user?.id },
    member: raw.member,

    options: {
      getString(name: string, required?: boolean) {
        const option = raw.data?.options?.find((o) => o.name === name);
        if (option?.value === undefined) {
          if (required) throw new Error(`Missing required option: ${name}`);
          return null;
        }
        return String(option.value);
      },
      getSubcommand(required?: boolean) {
        const sub = raw.data?.options?.find((o) => o.type === OPTION_TYPE_SUBCOMMAND);
        if (!sub) {
          if (required) throw new Error("Missing subcommand");
          return null;
        }
        return sub.name;
      },
    },

    async reply(options: unknown) {
      requireNotAcknowledged();
      deliver({ type: 4 /* CHANNEL_MESSAGE_WITH_SOURCE */, data: toRestPayload(options) });
    },

    async deferReply(options?: { flags?: number }) {
      requireNotAcknowledged();
      deliver({
        type: 5 /* DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE */,
        data: options?.flags !== undefined ? { flags: options.flags } : undefined,
      });
    },

    async editReply(options: unknown) {
      const res = await fetch(`${webhookBase}/messages/@original`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toRestPayload(options)),
      });
      if (!res.ok) throw new Error(`editReply failed: ${res.status} ${await res.text()}`);
    },

    async followUp(options: unknown) {
      const res = await fetch(webhookBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toRestPayload(options)),
      });
      if (!res.ok) throw new Error(`followUp failed: ${res.status} ${await res.text()}`);
    },

    async deleteReply() {
      const res = await fetch(`${webhookBase}/messages/@original`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`deleteReply failed: ${res.status} ${await res.text()}`);
    },
  };

  return shim as unknown as ChatInputCommandInteraction;
}
