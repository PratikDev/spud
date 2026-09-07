import { describe, expect, test } from "bun:test";
import type { ModalSubmitInteraction } from "discord.js";

import { decrypt } from "@/crypto";
import { db } from "@/db";
import { handleModalSubmit, MODAL_CUSTOM_ID_PREFIX } from "@/discord/commands/project/set-gemini-key";

async function insertProject(channelId: string, guildId: string, teamLead: string): Promise<number> {
  const rs = await db.execute({
    sql: `INSERT INTO projects (channel_id, guild_id, title, github_repo, default_branch, webhook_secret, team_lead)
          VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    args: [channelId, guildId, "Gemini Key Test", "o/r", "main", "secret", teamLead],
  });
  return (rs.rows[0] as unknown as { id: number }).id;
}

async function getStoredKey(projectId: number): Promise<string | null> {
  const rs = await db.execute({ sql: "SELECT gemini_api_key FROM projects WHERE id = ?", args: [projectId] });
  return (rs.rows[0] as unknown as { gemini_api_key: string | null }).gemini_api_key;
}

function fakeModalSubmit(
  channelId: string,
  userId: string,
  projectId: number,
  apiKeyInput: string,
): { interaction: ModalSubmitInteraction; replies: string[] } {
  const replies: string[] = [];
  const interaction = {
    customId: `${MODAL_CUSTOM_ID_PREFIX}${projectId}`,
    channelId,
    user: { id: userId },
    fields: { getTextInputValue: () => apiKeyInput },
    replied: false,
    deferred: false,
    reply: async (opts: { content: string }) => {
      replies.push(opts.content);
    },
  } as unknown as ModalSubmitInteraction;
  return { interaction, replies };
}

describe("handleModalSubmit", () => {
  test("saves an encrypted key for the team lead", async () => {
    const projectId = await insertProject("chan-gemini-1", "guild-gemini-1", "lead-1");
    const { interaction, replies } = fakeModalSubmit("chan-gemini-1", "lead-1", projectId, "my-real-api-key");

    await handleModalSubmit(interaction);

    const stored = await getStoredKey(projectId);
    expect(stored).not.toBeNull();
    expect(stored).not.toBe("my-real-api-key");
    expect(decrypt(stored as string)).toBe("my-real-api-key");
    expect(replies[0]).toContain("saved");
  });

  test("clears the key when submitted empty", async () => {
    const projectId = await insertProject("chan-gemini-2", "guild-gemini-2", "lead-2");
    await handleModalSubmit(fakeModalSubmit("chan-gemini-2", "lead-2", projectId, "some-key").interaction);
    expect(await getStoredKey(projectId)).not.toBeNull();

    const { interaction, replies } = fakeModalSubmit("chan-gemini-2", "lead-2", projectId, "");
    await handleModalSubmit(interaction);

    expect(await getStoredKey(projectId)).toBeNull();
    expect(replies[0]).toContain("removed");
  });

  test("rejects a submission from someone other than the team lead", async () => {
    const projectId = await insertProject("chan-gemini-3", "guild-gemini-3", "lead-3");
    const { interaction, replies } = fakeModalSubmit("chan-gemini-3", "not-the-lead", projectId, "sneaky-key");

    await handleModalSubmit(interaction);

    expect(await getStoredKey(projectId)).toBeNull();
    expect(replies[0]).toMatch(/team lead/i);
  });

  test("rejects when the project id in the customId no longer matches", async () => {
    const projectId = await insertProject("chan-gemini-4", "guild-gemini-4", "lead-4");
    const { interaction, replies } = fakeModalSubmit("chan-gemini-4", "lead-4", projectId + 999, "some-key");

    await handleModalSubmit(interaction);

    expect(await getStoredKey(projectId)).toBeNull();
    expect(replies[0]).toMatch(/no active project/i);
  });
});
