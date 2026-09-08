import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { db } from "@/db";
import { env } from "@/env";
import { handleWebhookRequest, startWebhookServer } from "@/github/webhook";

function sign(body: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function appSign(body: string) {
  return sign(body, env.GITHUB_APP_WEBHOOK_SECRET);
}

function makeRequest(body: string, signature: string, event = "ping"): Bun.BunRequest<"/webhooks/github/app"> {
  return {
    params: {},
    headers: new Headers({ "x-hub-signature-256": signature, "x-github-event": event }),
    text: async () => body,
  } as unknown as Bun.BunRequest<"/webhooks/github/app">;
}

async function insertProject(channelId: string, guildId: string, githubRepo: string): Promise<number> {
  const rs = await db.execute({
    sql: `INSERT INTO projects (channel_id, guild_id, title, github_repo, default_branch, team_lead)
          VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    args: [channelId, guildId, "Webhook Test", githubRepo, "main", "tester"],
  });
  return (rs.rows[0] as unknown as { id: number }).id;
}

describe("handleWebhookRequest routing", () => {
  test("401s for a bad signature", async () => {
    const body = JSON.stringify({ zen: "test" });
    const res = await handleWebhookRequest(makeRequest(body, sign(body, "wrong-secret")));
    expect(res.status).toBe(401);
  });

  test("200s a correctly signed ping event without needing any repository context", async () => {
    const body = JSON.stringify({ zen: "test", hook_id: 1 });
    const res = await handleWebhookRequest(makeRequest(body, appSign(body)));
    expect(res.status).toBe(200);
  });

  test("200s a push event for a repo with no linked active project (no-op)", async () => {
    const body = JSON.stringify({ ref: "refs/heads/feature/x", repository: { full_name: "nobody/unlinked-repo" } });
    const res = await handleWebhookRequest(makeRequest(body, appSign(body), "push"));
    expect(res.status).toBe(200);
  });

  test("200s a malformed JSON payload without throwing", async () => {
    const body = "{not valid json";
    const res = await handleWebhookRequest(makeRequest(body, appSign(body), "push"));
    expect(res.status).toBe(200);
  });

  test("200s a push event for a claimed branch with no Gemini key, skipping drift (no network call)", async () => {
    const githubRepo = "o/webhook-push-no-key";
    const projectId = await insertProject("chan-webhook-push-no-key", "guild-webhook-push-no-key", githubRepo);

    await db.execute({
      sql: `INSERT INTO tasks (branch_id, project_id, description, owner, status)
            VALUES (?, ?, ?, ?, 'claimed')`,
      args: ["feature/no-key", projectId, "Some task", "tester"],
    });

    const body = JSON.stringify({ ref: "refs/heads/feature/no-key", repository: { full_name: githubRepo } });
    const res = await handleWebhookRequest(makeRequest(body, appSign(body), "push"));
    expect(res.status).toBe(200);
  });

  test("429s once the per-project rate limit is exhausted", async () => {
    const githubRepo = "o/webhook-429";
    await insertProject("chan-webhook-429", "guild-webhook-429", githubRepo);
    const body = JSON.stringify({ ref: "refs/heads/no-such-branch", repository: { full_name: githubRepo } });
    const signature = appSign(body);

    let last: Response | undefined;
    for (let i = 0; i < 21; i++) {
      last = await handleWebhookRequest(makeRequest(body, signature, "push"));
    }
    expect(last?.status).toBe(429);
  });
});

describe("static routes", () => {
  test("serve the landing page, Terms of Service, and Privacy Policy", async () => {
    const server = startWebhookServer();
    try {
      const landing = await fetch(`http://localhost:${server.port}/`);
      expect(landing.status).toBe(200);
      expect(await landing.text()).toContain("<title>Spud</title>");

      const terms = await fetch(`http://localhost:${server.port}/terms`);
      expect(terms.status).toBe(200);
      expect(await terms.text()).toContain("Terms of Service");

      const privacy = await fetch(`http://localhost:${server.port}/privacy`);
      expect(privacy.status).toBe(200);
      expect(await privacy.text()).toContain("Privacy Policy");
    } finally {
      await server.stop();
    }
  });
});
