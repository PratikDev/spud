import type { Client } from "discord.js";
import { EmbedBuilder } from "discord.js";

import { db } from "@/db";
import { getTasksForProject } from "@/tasks";
import type { Project, Task } from "@/types";

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
    .setColor(0x2b6cb0)
    .addFields(
      { name: "🟢 Up for grabs", value: formatSection(unclaimed) },
      { name: "🔧 In progress", value: formatSection(claimed) },
      { name: "✅ Done", value: formatSection(done) },
    )
    .setFooter({ text: project.github_repo });
}

export async function updateBoard(client: Client, project: Project) {
  const embed = buildBoardEmbed(project, getTasksForProject(project.id));
  const channel = await client.channels.fetch(project.channel_id);
  if (!channel?.isTextBased() || !("send" in channel)) return;

  if (project.board_message_id) {
    try {
      const message = await channel.messages.fetch(project.board_message_id);
      await message.edit({ embeds: [embed] });
      return;
    } catch {
      // pinned message was deleted or otherwise unreachable; recreate it below
      console.warn(`Board message for project ${project.id} was deleted, creating a new one...`);
    }
  }

  const message = await channel.send({ embeds: [embed] });
  await message.pin().catch(() => { });
  db.query("UPDATE projects SET board_message_id = ? WHERE id = ?").run(message.id, project.id);
  project.board_message_id = message.id;
}
