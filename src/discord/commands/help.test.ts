import { describe, expect, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";

import { help } from "@/discord/commands/help";

describe("help", () => {
  test("replies ephemerally with a command overview and a link", async () => {
    let reply: { content: string; flags: number } | undefined;
    const interaction = {
      reply: async (r: { content: string; flags: number }) => {
        reply = r;
      },
    } as unknown as ChatInputCommandInteraction;

    await help.execute(interaction);

    expect(reply?.content).toContain("/claim");
    expect(reply?.content).toContain("/project set-gemini-key");
    expect(reply?.flags).toBe(64); // MessageFlags.Ephemeral
  });
});
