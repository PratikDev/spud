import { MessageFlags, SlashCommandBuilder } from "discord.js";

import type { Command } from "@/discord/commands";
import { env } from "@/env";

export const help: Command = {
  data: new SlashCommandBuilder().setName("help").setDescription("Show what Spud can do and where to find more info"),

  async execute(interaction) {
    const landingUrl = env.PUBLIC_BASE_URL ?? "(set PUBLIC_BASE_URL to show a link here)";

    await interaction.reply({
      content: [
        "**Spud** — hackathon task coordination for your team.",
        "",
        "**Project**",
        "`/project start` · `/project configure` · `/project end` · `/project status` · `/project list` · `/project set-gemini-key`",
        "",
        "**Tasks**",
        "`/claim` · `/tasks` · `/done` · `/free` · `/delete`",
        "",
        `More info, Terms of Service, and Privacy Policy: ${landingUrl}`,
      ].join("\n"),
      flags: MessageFlags.Ephemeral,
    });
  },
};
