import type { ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";

import { db, getActiveProject } from "@/db";
import { isTeamLead } from "@/discord/authorization";
import { NO_ACTIVE_PROJECT, NOT_TEAM_LEAD } from "@/discord/commands/constants";
import { parseWhen } from "@/utils/dates";

export function data(sub: SlashCommandSubcommandBuilder) {
  return sub
    .setName("configure")
    .setDescription("Set or update this project's timeline and handbook")
    .addStringOption((opt) =>
      opt
        .setName("start-time")
        .setDescription("When the hackathon officially starts, e.g. 'July 25 9am' or 'in 2 days'"),
    )
    .addStringOption((opt) =>
      opt.setName("end-time").setDescription("When the hackathon officially ends, e.g. 'July 27 6pm'"),
    )
    .addAttachmentOption((opt) => opt.setName("handbook").setDescription("Handbook file for this project"));
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

  const startTimeText = interaction.options.getString("start-time");
  const endTimeText = interaction.options.getString("end-time");
  const handbook = interaction.options.getAttachment("handbook");

  if (!startTimeText && !endTimeText && !handbook) {
    await interaction.reply({
      content: "Provide at least one of `start-time`, `end-time`, or `handbook` to configure.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const now = new Date();
  let startTime = project.start_time;
  let endTime = project.end_time;

  if (startTimeText) {
    const parsed = parseWhen(startTimeText, now);
    if (parsed === null) {
      await interaction.reply({
        content: `Couldn't understand start-time \`${startTimeText}\`. Try something like "July 25 9am" or "in 2 days".`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    startTime = parsed;
  }

  if (endTimeText) {
    const parsed = parseWhen(endTimeText, now);
    if (parsed === null) {
      await interaction.reply({
        content: `Couldn't understand end-time \`${endTimeText}\`. Try something like "July 27 6pm" or "in 4 days".`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    endTime = parsed;
  }

  if (startTime !== null && endTime !== null && endTime <= startTime) {
    await interaction.reply({
      content: "End time must be after start time.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Re-post the file as a channel message rather than storing its CDN URL directly —
  // Discord's attachment URLs carry a signed expiry, but a message id can always be
  // re-fetched for a fresh one (or just jumped to from the client).
  let handbookMessageId = project.handbook_message_id;
  if (handbook && interaction.channel?.isTextBased() && "send" in interaction.channel) {
    const message = await interaction.channel.send({
      content: `📋 Handbook updated by <@${interaction.user.id}>`,
      files: [{ attachment: handbook.url, name: handbook.name }],
    });
    handbookMessageId = message.id;
  }

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (startTimeText) {
    updates.push("start_time = ?");
    params.push(startTime);
  }
  if (endTimeText) {
    updates.push("end_time = ?");
    params.push(endTime);
  }
  if (handbookMessageId !== project.handbook_message_id) {
    updates.push("handbook_message_id = ?");
    params.push(handbookMessageId);
  }

  params.push(project.id);
  await db.execute({ sql: `UPDATE projects SET ${updates.join(", ")} WHERE id = ?`, args: params });

  const summary: string[] = [];
  if (startTimeText) summary.push(`Start: <t:${startTime}:F>`);
  if (endTimeText) summary.push(`End: <t:${endTime}:F>`);
  if (handbook) summary.push(`Handbook: uploaded`);

  await interaction.reply(summary.join("\n"));
}
