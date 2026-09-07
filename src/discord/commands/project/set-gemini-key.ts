import {
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  type SlashCommandSubcommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import { encrypt } from "@/crypto";
import { db, getActiveProject } from "@/db";
import { isTeamLead } from "@/discord/authorization";
import { NO_ACTIVE_PROJECT, NOT_TEAM_LEAD } from "@/discord/commands/constants";

export const MODAL_CUSTOM_ID_PREFIX = "set-gemini-key:";
const API_KEY_FIELD_ID = "api-key";

export function data(sub: SlashCommandSubcommandBuilder) {
  return sub
    .setName("set-gemini-key")
    .setDescription("Set or remove this project's Gemini API key to enable AI features (overlap/drift detection)");
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const project = await getActiveProject(interaction.channelId);

  if (!project) {
    await interaction.reply({ content: NO_ACTIVE_PROJECT, flags: MessageFlags.Ephemeral });
    return;
  }

  if (!isTeamLead(interaction, project)) {
    await interaction.reply({ content: NOT_TEAM_LEAD, flags: MessageFlags.Ephemeral });
    return;
  }

  const input = new TextInputBuilder()
    .setCustomId(API_KEY_FIELD_ID)
    .setLabel("Gemini API key (leave empty to remove)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(200);

  const modal = new ModalBuilder()
    .setCustomId(`${MODAL_CUSTOM_ID_PREFIX}${project.id}`)
    .setTitle("Gemini API key")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));

  // A plain string option here would show the key in the channel's message
  // history the moment the command is invoked, even with an ephemeral reply —
  // a modal submission never touches the channel at all.
  await interaction.showModal(modal);
}

export async function handleModalSubmit(interaction: ModalSubmitInteraction) {
  const projectId = interaction.customId.slice(MODAL_CUSTOM_ID_PREFIX.length);
  const project = interaction.channelId ? await getActiveProject(interaction.channelId) : null;

  if (!project || String(project.id) !== projectId) {
    await interaction.reply({ content: NO_ACTIVE_PROJECT, flags: MessageFlags.Ephemeral });
    return;
  }

  if (!isTeamLead(interaction, project)) {
    await interaction.reply({ content: NOT_TEAM_LEAD, flags: MessageFlags.Ephemeral });
    return;
  }

  const apiKey = interaction.fields.getTextInputValue(API_KEY_FIELD_ID).trim();
  await db.execute({
    sql: "UPDATE projects SET gemini_api_key = ? WHERE id = ?",
    args: [apiKey ? encrypt(apiKey) : null, project.id],
  });

  await interaction.reply({
    content: apiKey
      ? "Gemini API key saved — AI overlap/drift detection is now enabled for this project."
      : "Gemini API key removed — AI overlap/drift detection is now disabled for this project.",
    flags: MessageFlags.Ephemeral,
  });
}
