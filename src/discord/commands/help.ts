import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";

import type { Command } from "@/discord/commands";
import { env } from "@/env";
import { APP_INSTALL_URL } from "@/github/app-auth";

export const help: Command = {
  data: new SlashCommandBuilder().setName("help").setDescription("Show what Spud can do and where to find more info"),

  async execute(interaction) {
    const lines = [
      "**Spud** — small team task coordination.",
      "",
      "**Project**",
      "`/project start` · `/project configure` · `/project end` · `/project status` · `/project list` · `/project set-gemini-key`",
      "",
      "**Tasks**",
      "`/claim` · `/tasks` · `/done` · `/free` · `/delete`",
      "",
      `Install the [GitHub App](${APP_INSTALL_URL}) on your repo before running \`/project start\`.`,
    ];

    // Only shown when there's actually somewhere to send people — and only an
    // embed (not plain message content) renders `[text](url)` as a real link
    // on Discord, so this reply is an embed rather than plain content.
    if (env.PUBLIC_BASE_URL) {
      lines.push("", `More info in [here](${env.PUBLIC_BASE_URL})`);
    }

    await interaction.reply({
      embeds: [new EmbedBuilder().setDescription(lines.join("\n"))],
      flags: MessageFlags.Ephemeral,
    });
  },
};
