import { api } from "./api";

export type TaskStatus = "todo" | "in_progress" | "done";

export interface Task {
  id: number;
  project_id: number;
  area: string;
  name: string;
  trade: string;
  workers: number;
  hours: number;
  start_date: string;
  end_date: string | null;
  status: TaskStatus;
  progress: number;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: number;
  name: string;
  start_date: string;
  created_at: string;
  updated_at: string;
}

export interface TaskInput {
  area: string;
  name: string;
  trade: string;
  workers: number;
  hours: number;
  start_date: string;
  end_date: string | null;
  status: TaskStatus;
  progress: number;
}

export interface RolloverResult {
  moved: number;
  cutoff: string;
  moved_to: string;
}

export const getProject = (token: string | null) => api<Project>("/project", { token });

export const listTasks = (token: string | null) => api<Task[]>("/tasks", { token });

export const createTask = (token: string | null, body: TaskInput) =>
  api<Task>("/tasks", { method: "POST", body, token });

export const updateTask = (token: string | null, id: number, body: Partial<TaskInput>) =>
  api<Task>(`/tasks/${id}`, { method: "PATCH", body, token });

export const deleteTask = (token: string | null, id: number) =>
  api<null>(`/tasks/${id}`, { method: "DELETE", token });

export const rolloverTasks = (token: string | null, cutoff?: string) =>
  api<RolloverResult>(`/tasks/rollover${cutoff ? `?cutoff=${cutoff}` : ""}`, {
    method: "POST",
    token,
  });

export const TRADES = [
  "Demolition",
  "Civil",
  "Plumbing",
  "Electrical",
  "Carpentry",
  "Tiling",
  "Painting",
  "Cleaning",
  "Other",
];
