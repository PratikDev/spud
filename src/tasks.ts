import { db } from "@/db";
import { createLogger } from "@/logger";
import type { Task, TaskStatus } from "@/types";

const log = createLogger("tasks");

export function getTasksForProject(projectId: number): Task[] {
  const tasks = db.query("SELECT * FROM tasks WHERE project_id = ? ORDER BY id").all(projectId) as Task[];
  log.debug("Fetched tasks for project", { projectId, count: tasks.length });
  return tasks;
}

export function listTasksByStatus(projectId: number, status: TaskStatus): Task[] {
  const tasks = db.query("SELECT * FROM tasks WHERE project_id = ? AND status = ?").all(projectId, status) as Task[];
  log.debug("Fetched tasks by status", { projectId, status, count: tasks.length });
  return tasks;
}

export function findTaskByDescription(projectId: number, description: string, status: TaskStatus): Task | null {
  const task =
    (db
      .query("SELECT * FROM tasks WHERE project_id = ? AND status = ? AND description = ?")
      .get(projectId, status, description) as Task | null) ?? null;
  log.debug(task ? "Found task by description" : "No task found by description", { projectId, description, status });
  return task;
}

export function findTaskByBranch(projectId: number, branchId: string): Task | null {
  const task =
    (db.query("SELECT * FROM tasks WHERE project_id = ? AND branch_id = ?").get(projectId, branchId) as Task | null) ??
    null;
  log.debug(task ? "Found task by branch" : "No task found by branch", { projectId, branchId });
  return task;
}

export function createAndClaimTask(projectId: number, branchId: string, description: string, ownerId: string): Task {
  db.query(
    `INSERT INTO tasks (branch_id, project_id, description, owner, status)
     VALUES (?, ?, ?, ?, 'claimed')`,
  ).run(branchId, projectId, description, ownerId);
  log.info("Created and claimed task", { projectId, branchId, ownerId });
  return findTaskByBranch(projectId, branchId) as Task;
}

export function claimExistingTask(taskId: number, ownerId: string) {
  db.query("UPDATE tasks SET status = 'claimed', owner = ?, claimed_at = strftime('%s', 'now') WHERE id = ?").run(
    ownerId,
    taskId,
  );
  log.info("Claimed existing task", { taskId, ownerId });
}

export function markTaskDone(taskId: number) {
  db.query("UPDATE tasks SET status = 'done' WHERE id = ?").run(taskId);
  log.info("Marked task done", { taskId });
}

export function freeTask(taskId: number) {
  db.query("UPDATE tasks SET status = 'unclaimed', owner = NULL, claimed_at = NULL WHERE id = ?").run(taskId);
  log.info("Freed task", { taskId });
}

export function deleteTask(taskId: number) {
  db.query("DELETE FROM tasks WHERE id = ?").run(taskId);
  log.info("Deleted task", { taskId });
}

// The LLM's branch name is deterministic for a given description, but two
// different descriptions can still land on the same slug — this guarantees
// the (project_id, branch_id) uniqueness the schema requires either way.
export function ensureUniqueBranchId(projectId: number, baseBranchId: string): string {
  let candidate = baseBranchId;
  let suffix = 2;
  while (findTaskByBranch(projectId, candidate)) {
    candidate = `${baseBranchId}-${suffix}`;
    suffix++;
  }
  if (candidate !== baseBranchId) {
    log.warn("Branch id collision resolved with suffix", { projectId, baseBranchId, candidate });
  }
  return candidate;
}
