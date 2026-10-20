export type TaskStatus =
  | "pending"
  | "queued"
  | "running"
  | "paused"
  | "cancelled"
  | "interrupted"
  | "completed"
  | "failed";
export type ItemStatus =
  "pending" | "running" | "succeeded" | "failed" | "skipped";

export interface Book {
  id: string;
  site: string;
  url: string;
  title: string;
  updatedAt: string;
}

export interface ChapterLink {
  url: string;
  title: string;
  position: number;
}

export interface Chapter extends ChapterLink {
  id: string;
  bookId: string;
  content: string | null;
  fetchedAt: string | null;
}

export interface Task {
  id: string;
  bookId: string;
  siteConfig: string;
  status: TaskStatus;
  catalogComplete: number;
  refresh: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskItem extends ChapterLink {
  chapterId: string;
  taskId: string;
  status: ItemStatus;
  attempts: number;
  error: string | null;
}

export interface TaskSummary extends Task {
  title: string;
  total: number;
  succeeded: number;
  skipped: number;
  failed: number;
  pending: number;
  control: "pause" | "cancel" | null;
}

export interface Log {
  info(fields: object, message: string): void;
  warn(fields: object, message: string): void;
  error(fields: object, message: string): void;
}

export interface CrawlProgress {
  taskId: string;
  phase: "starting" | "catalog" | "chapter";
  total: number;
  done: number;
  skipped: number;
  failed: number;
}
