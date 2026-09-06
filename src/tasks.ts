import { db } from "@/db";
import { createLogger } from "@/logger";
import type { Task, TaskStatus } from "@/types";

const log = createLogger("tasks");

export async function getTasksForProject(projectId: number): Promise<Task[]> {
  const rs = await db.execute({ sql: "SELECT * FROM tasks WHERE project_id = ? ORDER BY id", args: [projectId] });
  const tasks = rs.rows as unknown as Task[];
  log.debug("Fetched tasks for project", { projectId, count: tasks.length });
  return tasks;
}

export async function listTasksByStatus(projectId: number, status: TaskStatus): Promise<Task[]> {
  const rs = await db.execute({
    sql: "SELECT * FROM tasks WHERE project_id = ? AND status = ?",
    args: [projectId, status],
  });
  const tasks = rs.rows as unknown as Task[];
  log.debug("Fetched tasks by status", { projectId, status, count: tasks.length });
  return tasks;
}

export async function findTaskByDescription(
  projectId: number,
  description: string,
  status: TaskStatus,
): Promise<Task | null> {
  const rs = await db.execute({
    sql: "SELECT * FROM tasks WHERE project_id = ? AND status = ? AND description = ?",
    args: [projectId, status, description],
  });
  const task = (rs.rows[0] as unknown as Task | undefined) ?? null;
  log.debug(task ? "Found task by description" : "No task found by description", { projectId, description, status });
  return task;
}

export async function findTaskByBranch(projectId: number, branchId: string): Promise<Task | null> {
  const rs = await db.execute({
    sql: "SELECT * FROM tasks WHERE project_id = ? AND branch_id = ?",
    args: [projectId, branchId],
  });
  const task = (rs.rows[0] as unknown as Task | undefined) ?? null;
  log.debug(task ? "Found task by branch" : "No task found by branch", { projectId, branchId });
  return task;
}

export async function createAndClaimTask(
  projectId: number,
  branchId: string,
  description: string,
  ownerId: string,
): Promise<Task> {
  await db.execute({
    sql: `INSERT INTO tasks (branch_id, project_id, description, owner, status)
          VALUES (?, ?, ?, ?, 'claimed')`,
    args: [branchId, projectId, description, ownerId],
  });
  log.info("Created and claimed task", { projectId, branchId, ownerId });
  return (await findTaskByBranch(projectId, branchId)) as Task;
}

export async function claimExistingTask(taskId: number, ownerId: string) {
  await db.execute({
    sql: "UPDATE tasks SET status = 'claimed', owner = ?, claimed_at = strftime('%s', 'now') WHERE id = ?",
    args: [ownerId, taskId],
  });
  log.info("Claimed existing task", { taskId, ownerId });
}

export async function markTaskDone(taskId: number) {
  await db.execute({ sql: "UPDATE tasks SET status = 'done' WHERE id = ?", args: [taskId] });
  log.info("Marked task done", { taskId });
}

export async function freeTask(taskId: number) {
  await db.execute({
    sql: "UPDATE tasks SET status = 'unclaimed', owner = NULL, claimed_at = NULL WHERE id = ?",
    args: [taskId],
  });
  log.info("Freed task", { taskId });
}

export async function deleteTask(taskId: number) {
  await db.execute({ sql: "DELETE FROM tasks WHERE id = ?", args: [taskId] });
  log.info("Deleted task", { taskId });
}

// The LLM's branch name is deterministic for a given description, but two
// different descriptions can still land on the same slug — this guarantees
// the (project_id, branch_id) uniqueness the schema requires either way.
export async function ensureUniqueBranchId(projectId: number, baseBranchId: string): Promise<string> {
  let candidate = baseBranchId;
  let suffix = 2;
  while (await findTaskByBranch(projectId, candidate)) {
    candidate = `${baseBranchId}-${suffix}`;
    suffix++;
  }
  if (candidate !== baseBranchId) {
    log.warn("Branch id collision resolved with suffix", { projectId, baseBranchId, candidate });
  }
  return candidate;
}
