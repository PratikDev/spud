import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

import type { Command } from "@/discord/commands";
import * as start from "./start";

// Each subcommand lives in its own file (data + execute) and gets one line
// here to register its builder, plus one switch case to dispatch to it.
export const project: Command = {
  data: new SlashCommandBuilder()
    .setName("project")
    .setDescription("Manage the hackathon project for this channel")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(start.data),

  async execute(interaction) {
    switch (interaction.options.getSubcommand()) {
      case "start":
        return start.execute(interaction);
    }
  },
};
