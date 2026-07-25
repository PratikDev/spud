import { SlashCommandBuilder } from "discord.js";

import type { Command } from "@/discord/commands";
import * as configure from "./configure";
import * as end from "./end";
import * as list from "./list";
import * as start from "./start";
import * as status from "./status";

const subcommandsExecute = {
  start: start.execute,
  configure: configure.execute,
  end: end.execute,
  status: status.execute,
  list: list.execute,
} as const;

// Each subcommand lives in its own file (data + execute) and gets one line
// here to register its builder, plus one switch case to dispatch to it.
export const project: Command = {
  data: new SlashCommandBuilder()
    .setName("project")
    .setDescription("Manage the hackathon project for this channel")
    .addSubcommand(start.data)
    .addSubcommand(configure.data)
    .addSubcommand(end.data)
    .addSubcommand(status.data)
    .addSubcommand(list.data),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand() as keyof typeof subcommandsExecute;
    const execute = subcommandsExecute[subcommand];
    if (!execute) {
      throw new Error(`Unknown subcommand: ${subcommand}`);
    }
    return execute(interaction);
  },
};
