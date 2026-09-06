import type { Client } from "discord.js";
import { EmbedBuilder } from "discord.js";

import { db } from "@/db";
import { createLogger } from "@/logger";
import { getTasksForProject } from "@/tasks";
import type { Project, Task } from "@/types";

const log = createLogger("discord/board");

function formatTask(task: Task): string {
  const owner = task.owner ? ` (<@${task.owner}>)` : "";
  return `• ${task.description} — \`${task.branch_id}\`${owner}`;
}

function formatSection(tasks: Task[]): string {
  return tasks.length > 0 ? tasks.map(formatTask).join("\n") : "_nothing here_";
}

export function buildBoardEmbed(project: Project, tasks: Task[]) {
  const unclaimed = tasks.filter((task) => task.status === "unclaimed");
  const claimed = tasks.filter((task) => task.status === "claimed");
  const done = tasks.filter((task) => task.status === "done");

  return new EmbedBuilder()
    .setTitle(project.title)
    .setURL(`https://github.com/${project.github_repo}`)
    .setColor(0xe3a857)
    .addFields(
      { name: "🟢 Up for grabs", value: formatSection(unclaimed) },
      { name: "🔧 In progress", value: formatSection(claimed) },
      { name: "✅ Done", value: formatSection(done) },
    )
    .setFooter({ text: project.github_repo });
}

export async function updateBoard(client: Client, project: Project) {
  const embed = buildBoardEmbed(project, await getTasksForProject(project.id));
  const channel = await client.channels.fetch(project.channel_id);
  if (!channel?.isTextBased() || !("send" in channel)) {
    log.warn("Could not update board — channel not sendable", { projectId: project.id });
    return;
  }

  if (project.board_message_id) {
    try {
      const message = await channel.messages.fetch(project.board_message_id);
      await message.edit({ embeds: [embed] });
      log.debug("Edited existing board message", { projectId: project.id, messageId: project.board_message_id });
      return;
    } catch {
      // pinned message was deleted or otherwise unreachable; recreate it below
      log.warn("Board message was deleted, creating a new one", { projectId: project.id });
    }
  }

  const message = await channel.send({ embeds: [embed] });
  try {
    await message.pin();
    log.debug("Pinned new board message", { projectId: project.id, messageId: message.id });
  } catch (error) {
    // Usually means the bot's role is missing "Manage Messages" in this channel.
    // The board still gets created/edited either way, just not pinned.
    log.warn("Failed to pin board message", { projectId: project.id, error: String(error) });
  }
  await db.execute({ sql: "UPDATE projects SET board_message_id = ? WHERE id = ?", args: [message.id, project.id] });
  project.board_message_id = message.id;
  log.info("Created board message", { projectId: project.id, messageId: message.id });
}

export async function unpinBoard(client: Client, project: Project) {
  if (!project.board_message_id) return;

  const channel = await client.channels.fetch(project.channel_id);
  if (!channel?.isTextBased() || !("messages" in channel)) {
    log.warn("Could not unpin board — channel not accessible", { projectId: project.id });
    return;
  }

  try {
    const message = await channel.messages.fetch(project.board_message_id);
    await message.unpin();
    log.info("Unpinned board message", { projectId: project.id, messageId: project.board_message_id });
  } catch (error) {
    // Board message may already be deleted, or the bot may lack "Manage Messages" —
    // either way there's nothing more to do here.
    log.warn("Failed to unpin board message", { projectId: project.id, error: String(error) });
  }
}
