import type { SiteConfig } from "../adapters/config.js";
import type { Book, Chapter, TaskItem, TaskSummary } from "../domain/models.js";

export type BookView = Book & { total: number; downloaded: number };
export interface SiteRecord {
  name: string;
  config: SiteConfig;
  updatedAt: string;
}
export interface Schedule {
  id: string;
  site: string;
  url: string;
  intervalMinutes: number;
  enabled: boolean;
  nextRunAt: number;
  lastRunAt: number | null;
  lastTaskId: string | null;
  error: string | null;
}
export interface ExportRecord {
  id: string;
  bookId: string;
  title: string;
  format: "txt" | "json";
  status: "running" | "completed" | "failed";
  missing: number;
  filename: string;
  error: string | null;
  createdAt: string;
}
export interface TaskEvent {
  id: number;
  level: string;
  message: string;
  data: string;
  createdAt: string;
}
export interface WorkerState {
  status: "starting" | "ready" | "busy" | "blocked" | "stopped";
  taskId: string | null;
  error: string | null;
}
export interface Dashboard {
  books: BookView[];
  tasks: TaskSummary[];
  sites: SiteRecord[];
  schedules: Schedule[];
  exports: ExportRecord[];
  worker: WorkerState;
  stats: {
    books: number;
    chapters: number;
    downloaded: number;
    running: number;
    queued: number;
    failed: number;
    completed: number;
  };
}
export interface PageResult<T> {
  items: T[];
  total: number;
}
export type ChapterSummary = Omit<Chapter, "content"> & { downloaded: boolean };
export interface TaskDetail {
  task: TaskSummary;
  items: PageResult<TaskItem>;
  events: TaskEvent[];
}
export interface PreviewResult {
  title: string;
  total: number;
  chapters: { title: string; url: string }[];
  sample: { title: string; text: string; characters: number };
}
