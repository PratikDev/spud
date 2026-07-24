export type ProjectStatus = "active" | "ended";
export type TaskStatus = "unclaimed" | "claimed" | "done";

export interface Project {
  id: number;
  public_id: string;
  channel_id: string;
  guild_id: string;
  title: string;
  github_repo: string;
  webhook_secret: string;
  status: ProjectStatus;
  created_at: number;
  start_time: number | null;
  end_time: number | null;
  rulebook_message_id: string | null;
  ended_at: number | null;
  board_message_id: string | null;
}

export interface Task {
  id: number;
  branch_id: string;
  project_id: number;
  description: string;
  owner: string | null;
  status: TaskStatus;
  claimed_at: number | null;
}
