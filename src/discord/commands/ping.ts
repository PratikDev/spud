import { SlashCommandBuilder } from "discord.js";
import type { Command } from "./index";

export const ping: Command = {
  data: new SlashCommandBuilder().setName("ping").setDescription("Replies with pong"),
  async execute(interaction) {
    await interaction.reply("pong");
  },
};
