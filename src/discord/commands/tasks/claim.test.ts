import { describe, expect, mock, test } from "bun:test";
import { APICallError } from "ai";
import type { ChatInputCommandInteraction } from "discord.js";

import { db } from "@/db";
import { claim, describeAiFailure } from "@/discord/commands/tasks/claim";
import type { ClaimAnalysis } from "@/llm/claim-analysis";

// Gemini is never called for real in tests — each /claim test sets what the
// analyzer returns (or throws) via this.
let analyzeClaimResult: () => Promise<ClaimAnalysis> = async () => ({ overlappingTask: null });
mock.module("@/llm/claim-analysis", () => ({ analyzeClaim: () => analyzeClaimResult() }));

async function insertProject(channelId: string, opts: { timelineSet?: boolean } = {}): Promise<number> {
  const { timelineSet = true } = opts;
  const rs = await db.execute({
    sql: `INSERT INTO projects (channel_id, guild_id, title, github_repo, default_branch, team_lead, start_time, end_time)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    args: [
      channelId,
      `guild-${channelId}`,
      "Claim Test",
      `o/${channelId}`,
      "main",
      "lead-1",
      timelineSet ? 1000 : null,
      timelineSet ? 2000 : null,
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

  test("names a rate limit on 429", () => {
    expect(describeAiFailure(apiError(429))).toMatch(/rate limit/i);
  });

  test("falls back to a generic message for anything else", () => {
    expect(describeAiFailure(apiError(401))).toMatch(/unexpectedly/i);
    expect(describeAiFailure(apiError(403))).toMatch(/unexpectedly/i);
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

  test("claims fine without a start/end time configured", async () => {
    analyzeClaimResult = async () => ({ overlappingTask: null });
    await insertProject("chan-claim-notime", { timelineSet: false });
    const { interaction, replies } = fakeClaimInteraction("chan-claim-notime", "user-1", "something");
    await claim.execute(interaction);
    expect(replies[0]).toContain("feature/something");
  });

  test("names the branch from the description (no AI) for a new task", async () => {
    analyzeClaimResult = async () => ({ overlappingTask: null });
    await insertProject("chan-claim-ai");
    const { interaction, replies } = fakeClaimInteraction("chan-claim-ai", "user-1", "Fix the login bug");
    await claim.execute(interaction);

    expect(replies[0]).toContain("fix/login");
    expect(replies[0]).not.toMatch(/AI overlap detection/i);

    const rs = await db.execute({ sql: "SELECT status, owner FROM tasks WHERE branch_id = 'fix/login'", args: [] });
    const task = rs.rows[0] as unknown as { status: string; owner: string };
    expect(task.status).toBe("claimed");
    expect(task.owner).toBe("user-1");
  });

  test("rejects a likely duplicate, naming the existing task, and creates nothing", async () => {
    const projectId = await insertProject("chan-claim-dup");
    await db.execute({
      sql: `INSERT INTO tasks (branch_id, project_id, description, owner, status) VALUES (?, ?, ?, ?, 'claimed')`,
      args: ["feature/login", projectId, "Build login", "user-9"],
    });
    analyzeClaimResult = async () => ({ overlappingTask: "Build login" });

    const { interaction, replies } = fakeClaimInteraction("chan-claim-dup", "user-1", "Auth flow");
    await claim.execute(interaction);

    expect(replies[0]).toMatch(/duplicate/i);
    expect(replies[0]).toContain("Build login");
    const rs = await db.execute({ sql: "SELECT id FROM tasks WHERE branch_id = 'feature/auth-flow'", args: [] });
    expect(rs.rows.length).toBe(0);
  });

  test("still names the branch and notes the failure when the AI call throws", async () => {
    analyzeClaimResult = async () => {
      throw new Error("network blip");
    };
    await insertProject("chan-claim-aifail");
    const { interaction, replies } = fakeClaimInteraction("chan-claim-aifail", "user-1", "Fix the login bug");
    await claim.execute(interaction);

    expect(replies[0]).toContain("fix/login");
    expect(replies[0]).toMatch(/AI overlap detection failed/i);
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
