import { api } from "./api";

export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "normal" | "high";

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
  priority: TaskPriority;
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
  priority: TaskPriority;
  progress: number;
}

export const getProject = (token: string | null) => api<Project>("/project", { token });

export const listTasks = (token: string | null) => api<Task[]>("/tasks", { token });

/** Authoritative off-days (Sundays + holidays) in [from, to]. */
export const getOffDays = (token: string | null, from: string, to: string) =>
  api<string[]>(`/project/off-days?from=${from}&to=${to}`, { token });

export const createTask = (token: string | null, body: TaskInput) =>
  api<Task>("/tasks", { method: "POST", body, token });

export const updateTask = (token: string | null, id: number, body: Partial<TaskInput>) =>
  api<Task>(`/tasks/${id}`, { method: "PATCH", body, token });

export const deleteTask = (token: string | null, id: number) =>
  api<null>(`/tasks/${id}`, { method: "DELETE", token });

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
