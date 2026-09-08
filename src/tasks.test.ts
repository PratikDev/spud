import { beforeAll, describe, expect, test } from "bun:test";

import { db } from "@/db";
import {
  claimExistingTask,
  createAndClaimTask,
  deleteTask,
  ensureUniqueBranchId,
  findTaskByBranch,
  findTaskByDescription,
  freeTask,
  getTasksForProject,
  listTasksByStatus,
  markTaskDone,
} from "@/tasks";

let projectId: number;

beforeAll(async () => {
  const rs = await db.execute({
    sql: `INSERT INTO projects (channel_id, guild_id, title, github_repo, default_branch, team_lead)
          VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    args: ["chan-tasks-test", "guild-tasks-test", "Tasks Test", "o/r", "main", "tester"],
  });
  projectId = (rs.rows[0] as unknown as { id: number }).id;
});

describe("createAndClaimTask + findTaskByBranch", () => {
  test("creates a task already claimed by its creator", async () => {
    const task = await createAndClaimTask(projectId, "feature/x", "Build X", "user1");
    expect(task.status).toBe("claimed");
    expect(task.owner).toBe("user1");
    expect(task.branch_id).toBe("feature/x");

    const found = await findTaskByBranch(projectId, "feature/x");
    expect(found?.id).toBe(task.id);
  });

  test("returns null for a branch with no task", async () => {
    expect(await findTaskByBranch(projectId, "no-such-branch")).toBeNull();
  });
});

describe("claim / done / free / delete lifecycle", () => {
  test("transitions a task through every status correctly", async () => {
    const task = await createAndClaimTask(projectId, "feature/lifecycle", "Lifecycle task", "user1");

    await freeTask(task.id);
    let current = await findTaskByBranch(projectId, "feature/lifecycle");
    expect(current?.status).toBe("unclaimed");
    expect(current?.owner).toBeNull();

    await claimExistingTask(task.id, "user2");
    current = await findTaskByBranch(projectId, "feature/lifecycle");
    expect(current?.status).toBe("claimed");
    expect(current?.owner).toBe("user2");

    await markTaskDone(task.id);
    current = await findTaskByBranch(projectId, "feature/lifecycle");
    expect(current?.status).toBe("done");

    await deleteTask(task.id);
    expect(await findTaskByBranch(projectId, "feature/lifecycle")).toBeNull();
  });
});

describe("listTasksByStatus / getTasksForProject", () => {
  test("filters by status and lists every task for the project", async () => {
    await createAndClaimTask(projectId, "feature/a", "Task A", "user1");
    await createAndClaimTask(projectId, "feature/b", "Task B", "user2");

    const claimed = await listTasksByStatus(projectId, "claimed");
    expect(claimed.length).toBeGreaterThanOrEqual(2);
    expect(claimed.every((t) => t.status === "claimed")).toBe(true);

    const all = await getTasksForProject(projectId);
    expect(all.length).toBeGreaterThanOrEqual(claimed.length);
  });
});

describe("findTaskByDescription", () => {
  test("finds a task by exact description + status", async () => {
    await db.execute({
      sql: "INSERT INTO tasks (branch_id, project_id, description, status) VALUES (?, ?, ?, 'unclaimed')",
      args: ["feature/unclaimed", projectId, "Unclaimed work"],
    });
    const found = await findTaskByDescription(projectId, "Unclaimed work", "unclaimed");
    expect(found?.branch_id).toBe("feature/unclaimed");
  });

  test("returns null when the status doesn't match", async () => {
    expect(await findTaskByDescription(projectId, "Unclaimed work", "done")).toBeNull();
  });
});

describe("ensureUniqueBranchId", () => {
  test("returns the base id when there's no collision", async () => {
    expect(await ensureUniqueBranchId(projectId, "feature/fresh-slug")).toBe("feature/fresh-slug");
  });

  test("appends -2, -3, ... on collision", async () => {
    await createAndClaimTask(projectId, "feature/dup", "Dup 1", "user1");
    expect(await ensureUniqueBranchId(projectId, "feature/dup")).toBe("feature/dup-2");

    await createAndClaimTask(projectId, "feature/dup-2", "Dup 2", "user1");
    expect(await ensureUniqueBranchId(projectId, "feature/dup")).toBe("feature/dup-3");
  });
});
