import { describe, expect, test } from "bun:test";
import { APICallError } from "ai";
import type { ChatInputCommandInteraction } from "discord.js";

import { db } from "@/db";
import { claim, describeAiFailure } from "@/discord/commands/tasks/claim";

async function insertProject(
  channelId: string,
  opts: { timelineSet?: boolean; geminiKey?: string | null } = {},
): Promise<number> {
  const { timelineSet = true, geminiKey = null } = opts;
  const rs = await db.execute({
    sql: `INSERT INTO projects (channel_id, guild_id, title, github_repo, default_branch, team_lead, start_time, end_time, gemini_api_key)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    args: [
      channelId,
      `guild-${channelId}`,
      "Claim Test",
      `o/${channelId}`,
      "main",
      "lead-1",
      timelineSet ? 1000 : null,
      timelineSet ? 2000 : null,
      geminiKey,
    ],
  });
  return (rs.rows[0] as unknown as { id: number }).id;
}

// A client whose channel lookup fails harmlessly — updateBoard() already
// handles a missing/inaccessible channel by logging and returning.
const fakeClient = { channels: { fetch: async () => null } } as unknown as ChatInputCommandInteraction["client"];

function fakeClaimInteraction(
  channelId: string,
  userId: string,
  description: string,
): { interaction: ChatInputCommandInteraction; replies: string[] } {
  const replies: string[] = [];
  const interaction = {
    channelId,
    user: { id: userId },
    client: fakeClient,
    options: { getString: () => description },
    deferReply: async () => {},
    editReply: async (opts: { content: string } | string) => {
      replies.push(typeof opts === "string" ? opts : opts.content);
    },
    deleteReply: async () => {},
    followUp: async (opts: { content: string } | string) => {
      replies.push(typeof opts === "string" ? opts : opts.content);
    },
  } as unknown as ChatInputCommandInteraction;
  return { interaction, replies };
}

describe("describeAiFailure", () => {
  const apiError = (statusCode: number) =>
    new APICallError({ message: "boom", url: "https://example.test", requestBodyValues: {}, statusCode });

  test("names an invalid/revoked key on 401", () => {
    expect(describeAiFailure(apiError(401))).toMatch(/invalid or revoked/i);
    expect(describeAiFailure(apiError(401))).toContain("/project set-gemini-key");
  });

  test("names an invalid/revoked key on 403", () => {
    expect(describeAiFailure(apiError(403))).toMatch(/invalid or revoked/i);
  });

  test("names a rate limit on 429", () => {
    expect(describeAiFailure(apiError(429))).toMatch(/rate limit/i);
  });

  test("falls back to a generic message for anything else", () => {
    expect(describeAiFailure(apiError(500))).toMatch(/unexpectedly/i);
    expect(describeAiFailure(new Error("network blip"))).toMatch(/unexpectedly/i);
    expect(describeAiFailure("not even an Error instance")).toMatch(/unexpectedly/i);
  });
});

describe("/claim", () => {
  test("replies with NO_ACTIVE_PROJECT when the channel has no active project", async () => {
    const { interaction, replies } = fakeClaimInteraction("chan-claim-none", "user-1", "something");
    await claim.execute(interaction);
    expect(replies[0]).toMatch(/no active project/i);
  });

  test("asks for a timeline before claiming when start/end time aren't set", async () => {
    await insertProject("chan-claim-notime", { timelineSet: false });
    const { interaction, replies } = fakeClaimInteraction("chan-claim-notime", "user-1", "something");
    await claim.execute(interaction);
    expect(replies[0]).toMatch(/start and end time/i);
  });

  test("without a Gemini key, creates the task with a plain slug and notes AI is off", async () => {
    await insertProject("chan-claim-nokey");
    const { interaction, replies } = fakeClaimInteraction("chan-claim-nokey", "user-1", "Fix the login bug");
    await claim.execute(interaction);

    expect(replies[0]).toContain("task/fix-the-login-bug");
    expect(replies[0]).toMatch(/AI overlap detection is off/i);

    const rs = await db.execute({
      sql: "SELECT status, owner FROM tasks WHERE branch_id = 'task/fix-the-login-bug'",
      args: [],
    });
    const task = rs.rows[0] as unknown as { status: string; owner: string };
    expect(task.status).toBe("claimed");
    expect(task.owner).toBe("user-1");
  });

  test("claiming an existing unclaimed task skips branch creation entirely", async () => {
    const projectId = await insertProject("chan-claim-existing");
    await db.execute({
      sql: `INSERT INTO tasks (branch_id, project_id, description, status) VALUES (?, ?, ?, 'unclaimed')`,
      args: ["feature/already-here", projectId, "Already here"],
    });

    const { interaction, replies } = fakeClaimInteraction("chan-claim-existing", "user-2", "Already here");
    await claim.execute(interaction);

    expect(replies[0]).toContain("feature/already-here");
    const rs = await db.execute({
      sql: "SELECT status, owner FROM tasks WHERE branch_id = 'feature/already-here'",
      args: [],
    });
    const task = rs.rows[0] as unknown as { status: string; owner: string };
    expect(task.status).toBe("claimed");
    expect(task.owner).toBe("user-2");
  });
});
