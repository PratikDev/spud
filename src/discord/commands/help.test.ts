import { describe, expect, test } from "bun:test";
import type { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";

import { help } from "@/discord/commands/help";

describe("help", () => {
  test("replies ephemerally with a command overview", async () => {
    let reply: { embeds: EmbedBuilder[]; flags: number } | undefined;
    const interaction = {
      reply: async (r: { embeds: EmbedBuilder[]; flags: number }) => {
        reply = r;
      },
    } as unknown as ChatInputCommandInteraction;

    await help.execute(interaction);

    const description = reply?.embeds[0]?.toJSON().description;
    expect(description).toContain("/claim");
    expect(description).toContain("/project set-gemini-key");
    expect(description).toContain("Install the [GitHub App]");
    expect(reply?.flags).toBe(64); // MessageFlags.Ephemeral
  });

  // PUBLIC_BASE_URL is unset in .env.test (it's optional — see env.ts), so
  // this exercises the real "not configured" path rather than a faked one.
  test("omits the info line when PUBLIC_BASE_URL is unset", async () => {
    let reply: { embeds: EmbedBuilder[] } | undefined;
    const interaction = {
      reply: async (r: { embeds: EmbedBuilder[] }) => {
        reply = r;
      },
    } as unknown as ChatInputCommandInteraction;

    await help.execute(interaction);

    const description = reply?.embeds[0]?.toJSON().description;
    expect(description).not.toContain("More info in");
  });
});
