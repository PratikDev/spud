import * as chrono from "chrono-node";
import type { ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";

import { db, getActiveProject } from "@/db";
import { NO_ACTIVE_PROJECT } from "@/discord/commands/constants";

export function data(sub: SlashCommandSubcommandBuilder) {
  return sub
    .setName("configure")
    .setDescription("Set or update this project's timeline and rulebook")
    .addStringOption((opt) =>
      opt
        .setName("start-time")
        .setDescription("When the hackathon officially starts, e.g. 'July 25 9am' or 'in 2 days'"),
    )
    .addStringOption((opt) =>
      opt.setName("end-time").setDescription("When the hackathon officially ends, e.g. 'July 27 6pm'"),
    )
    .addAttachmentOption((opt) => opt.setName("rulebook").setDescription("Rulebook file for this hackathon"));
}

// No multi-timezone support: natural-language dates are parsed relative to whatever
// timezone this process runs in. Fine for a single team, not for distributed ones.
function parseWhen(text: string, now: Date): number | null {
  const parsed = chrono.parseDate(text, now, { forwardDate: true });
  return parsed ? Math.floor(parsed.getTime() / 1000) : null;
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const project = getActiveProject(interaction.channelId);

  if (!project) {
    await interaction.reply({ content: NO_ACTIVE_PROJECT, flags: MessageFlags.Ephemeral });
    return;
  }

  const startTimeText = interaction.options.getString("start-time");
  const endTimeText = interaction.options.getString("end-time");
  const rulebook = interaction.options.getAttachment("rulebook");

  if (!startTimeText && !endTimeText && !rulebook) {
    await interaction.reply({
      content: "Provide at least one of `start-time`, `end-time`, or `rulebook` to configure.",
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
  let rulebookMessageId = project.rulebook_message_id;
  if (rulebook && interaction.channel?.isTextBased() && "send" in interaction.channel) {
    const message = await interaction.channel.send({
      content: `📋 Rulebook updated by <@${interaction.user.id}>`,
      files: [{ attachment: rulebook.url, name: rulebook.name }],
    });
    rulebookMessageId = message.id;
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
  if (rulebookMessageId !== project.rulebook_message_id) {
    updates.push("rulebook_message_id = ?");
    params.push(rulebookMessageId);
  }

  params.push(project.id);
  db.query(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`).run(...params);

  const summary: string[] = [];
  if (startTimeText) summary.push(`Start: <t:${startTime}:F>`);
  if (endTimeText) summary.push(`End: <t:${endTime}:F>`);
  if (rulebook) summary.push(`Rulebook: uploaded`);

  await interaction.reply(summary.join("\n"));
}
