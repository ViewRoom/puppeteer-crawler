import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  canonicalUrl,
  siteSchema,
  type SiteConfig,
} from "../../adapters/config.js";
import { ConflictError, NotFoundError } from "../../domain/errors.js";
import type {
  ChapterSummary,
  ExportRecord,
  PageResult,
  Schedule,
  SiteRecord,
  TaskEvent,
} from "../../shared/contracts.js";
import { migrate } from "./schema.js";
import type {
  Book,
  Chapter,
  ChapterLink,
  Task,
  TaskItem,
  TaskStatus,
  TaskSummary,
} from "../../domain/models.js";

const taskColumns = `id, book_id AS bookId, site_config AS siteConfig, status,
  catalog_complete AS catalogComplete, refresh, error, created_at AS createdAt, updated_at AS updatedAt`;
const bookColumns = "id, site, url, title, updated_at AS updatedAt";

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    try {
      migrate(this.db);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createTask(config: SiteConfig, url: string, refresh = false): Task {
    return this.transaction(() => this.insertTask(config, url, refresh));
  }

  private insertTask(
    config: SiteConfig,
    inputUrl: string,
    refresh: boolean,
  ): Task {
    const url = canonicalUrl(inputUrl);
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO books(id, site, url, title, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(site, url) DO NOTHING",
      )
      .run(randomUUID(), config.name, url, url, now);
    const book = this.db
      .prepare(`SELECT ${bookColumns} FROM books WHERE site = ? AND url = ?`)
      .get(config.name, url) as unknown as Book;
    const unfinished = this.db
      .prepare(
        "SELECT id FROM tasks WHERE book_id = ? AND status IN ('pending', 'queued', 'running', 'paused', 'interrupted', 'failed')",
      )
      .get(book.id);
    if (unfinished)
      throw new ConflictError(
        `该书已有未完成任务 ${unfinished.id}，请继续或重试该任务`,
      );
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO tasks(id, book_id, site_config, status, refresh, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)",
      )
      .run(id, book.id, JSON.stringify(config), Number(refresh), now, now);
    return this.getTask(id);
  }

  getBook(id: string): Book {
    const book = this.db
      .prepare(`SELECT ${bookColumns} FROM books WHERE id = ?`)
      .get(id);
    if (!book) throw new NotFoundError(`书籍不存在: ${id}`);
    return book as unknown as Book;
  }

  listBooks(): (Book & { total: number; downloaded: number })[] {
    return this.db
      .prepare(
        `SELECT b.id, b.site, b.url, b.title, b.updated_at AS updatedAt,
      COUNT(c.id) AS total, COUNT(c.content) AS downloaded FROM books b
      LEFT JOIN chapters c ON c.book_id = b.id AND c.active = 1
      GROUP BY b.id ORDER BY b.updated_at DESC`,
      )
      .all() as unknown as (Book & { total: number; downloaded: number })[];
  }

  getTask(id: string): Task {
    const task = this.db
      .prepare(`SELECT ${taskColumns} FROM tasks WHERE id = ?`)
      .get(id);
    if (!task) throw new NotFoundError(`任务不存在: ${id}`);
    return task as unknown as Task;
  }

  listTasks(limit = 50): TaskSummary[] {
    const tasks = this.db
      .prepare(
        `SELECT id FROM tasks ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(limit);
    return tasks.map((task) => this.summary(String(task.id)));
  }

  summary(id: string): TaskSummary {
    const task = this.getTask(id);
    const counts = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
      COALESCE(SUM(status = 'succeeded'), 0) AS succeeded,
      COALESCE(SUM(status = 'skipped'), 0) AS skipped,
      COALESCE(SUM(status = 'failed'), 0) AS failed,
      COALESCE(SUM(status IN ('pending', 'running')), 0) AS pending
      FROM task_items WHERE task_id = ?`,
      )
      .get(id)!;
    return {
      ...task,
      title: this.getBook(task.bookId).title,
      total: Number(counts.total),
      succeeded: Number(counts.succeeded),
      skipped: Number(counts.skipped),
      failed: Number(counts.failed),
      pending: Number(counts.pending),
      control: this.control(id),
    };
  }

  status(id: string, status: TaskStatus, error: string | null = null): void {
    this.db
      .prepare(
        "UPDATE tasks SET status = ?, error = ?, updated_at = ? WHERE id = ?",
      )
      .run(status, error, new Date().toISOString(), id);
  }

  recoverInterrupted(): void {
    this.transaction(() => {
      this.db
        .prepare(
          "UPDATE task_items SET status = 'pending' WHERE status = 'running'",
        )
        .run();
      this.db
        .prepare(
          `UPDATE tasks SET status = CASE (SELECT action FROM task_controls WHERE task_id = tasks.id)
            WHEN 'pause' THEN 'paused' WHEN 'cancel' THEN 'cancelled' ELSE 'interrupted' END,
            error = '上次进程退出，已保留进度', updated_at = ? WHERE status = 'running'`,
        )
        .run(new Date().toISOString());
      this.db.prepare("DELETE FROM task_controls").run();
    });
  }

  saveCatalog(
    taskId: string,
    title: string,
    links: ChapterLink[],
    refresh: boolean,
  ): void {
    this.transaction(() => {
      const task = this.getTask(taskId);
      this.db
        .prepare("UPDATE books SET title = ?, updated_at = ? WHERE id = ?")
        .run(title, new Date().toISOString(), task.bookId);
      this.db
        .prepare("UPDATE chapters SET active = 0 WHERE book_id = ?")
        .run(task.bookId);
      const upsert = this.db
        .prepare(`INSERT INTO chapters(id, book_id, url, title, position) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(book_id, url) DO UPDATE SET title = excluded.title, position = excluded.position, active = 1`);
      const find = this.db.prepare(
        "SELECT id, content FROM chapters WHERE book_id = ? AND url = ?",
      );
      const insert = this.db.prepare(
        "INSERT INTO task_items(task_id, chapter_id, position, title, status) VALUES (?, ?, ?, ?, ?)",
      );
      for (const link of links) {
        upsert.run(
          randomUUID(),
          task.bookId,
          link.url,
          link.title,
          link.position,
        );
        const chapter = find.get(task.bookId, link.url)!;
        insert.run(
          taskId,
          chapter.id!,
          link.position,
          link.title,
          !refresh && chapter.content !== null ? "skipped" : "pending",
        );
      }
      this.db
        .prepare(
          "UPDATE tasks SET catalog_complete = 1, updated_at = ? WHERE id = ?",
        )
        .run(new Date().toISOString(), taskId);
    });
  }

  items(taskId: string): TaskItem[] {
    return this.db
      .prepare(
        `SELECT i.task_id AS taskId, i.chapter_id AS chapterId, i.position, i.title,
      i.status, i.attempts, i.error, c.url FROM task_items i JOIN chapters c ON c.id = i.chapter_id
      WHERE i.task_id = ? ORDER BY i.position`,
      )
      .all(taskId) as unknown as TaskItem[];
  }

  prepareRetry(taskId: string): void {
    this.db
      .prepare(
        "UPDATE task_items SET status = 'pending', error = NULL WHERE task_id = ? AND status = 'failed'",
      )
      .run(taskId);
  }

  updateConfig(taskId: string, config: SiteConfig): void {
    this.db
      .prepare("UPDATE tasks SET site_config = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(config), new Date().toISOString(), taskId);
  }

  attempt(taskId: string, chapterId: string): void {
    this.db
      .prepare(
        "UPDATE task_items SET status = 'running', attempts = attempts + 1, error = NULL WHERE task_id = ? AND chapter_id = ?",
      )
      .run(taskId, chapterId);
  }

  succeed(taskId: string, chapterId: string, content: string): void {
    this.transaction(() => {
      this.db
        .prepare("UPDATE chapters SET content = ?, fetched_at = ? WHERE id = ?")
        .run(content, new Date().toISOString(), chapterId);
      this.db
        .prepare(
          "UPDATE task_items SET status = 'succeeded', error = NULL WHERE task_id = ? AND chapter_id = ?",
        )
        .run(taskId, chapterId);
    });
  }

  fail(taskId: string, chapterId: string, error: string): void {
    this.db
      .prepare(
        "UPDATE task_items SET status = 'failed', error = ? WHERE task_id = ? AND chapter_id = ?",
      )
      .run(error, taskId, chapterId);
  }

  resetRunning(taskId: string): void {
    this.db
      .prepare(
        "UPDATE task_items SET status = 'pending' WHERE task_id = ? AND status = 'running'",
      )
      .run(taskId);
  }

  chapters(bookId: string): Chapter[] {
    return this.db
      .prepare(
        `SELECT id, book_id AS bookId, url, title, position, content, fetched_at AS fetchedAt
      FROM chapters WHERE book_id = ? AND active = 1 ORDER BY position`,
      )
      .all(bookId) as unknown as Chapter[];
  }

  createQueuedTask(config: SiteConfig, url: string, refresh = false): Task {
    return this.transaction(() => {
      const task = this.insertTask(config, url, refresh);
      this.putQueue(task.id, "resume");
      return this.getTask(task.id);
    });
  }

  private putQueue(taskId: string, mode: "resume" | "retry"): void {
    this.db
      .prepare(
        "INSERT INTO task_queue(task_id, mode, queued_at) VALUES (?, ?, ?)",
      )
      .run(taskId, mode, new Date().toISOString());
    this.status(taskId, "queued");
  }

  enqueue(taskId: string, mode: "resume" | "retry", config?: SiteConfig): void {
    this.transaction(() => {
      const task = this.getTask(taskId);
      if (!["pending", "paused", "interrupted", "failed"].includes(task.status))
        throw new ConflictError(
          `当前任务状态为 ${task.status}，不能重复加入队列`,
        );
      if (config) {
        if (config.name !== this.getBook(task.bookId).site)
          throw new ConflictError("站点名称与任务不一致");
        this.updateConfig(taskId, config);
      }
      this.db
        .prepare("DELETE FROM task_controls WHERE task_id = ?")
        .run(taskId);
      this.putQueue(taskId, mode);
    });
  }

  nextJob(): { taskId: string; mode: "resume" | "retry" } | undefined {
    return this.db
      .prepare(
        `SELECT q.task_id AS taskId, q.mode FROM task_queue q
      JOIN tasks t ON t.id = q.task_id WHERE t.status = 'queued' ORDER BY q.queued_at, q.rowid LIMIT 1`,
      )
      .get() as unknown as
      { taskId: string; mode: "resume" | "retry" } | undefined;
  }

  beginRun(
    taskId: string,
    retryFailed: boolean,
    fromQueue: boolean,
    override?: SiteConfig,
  ): void {
    this.transaction(() => {
      const task = this.getTask(taskId);
      const allowed = fromQueue
        ? ["queued"]
        : ["pending", "paused", "interrupted", "failed"];
      if (!allowed.includes(task.status))
        throw new ConflictError(`任务状态已变化 (${task.status})，未启动采集`);
      if (
        fromQueue &&
        !this.db
          .prepare("SELECT task_id FROM task_queue WHERE task_id = ?")
          .get(taskId)
      )
        throw new ConflictError("任务已移出队列");
      if (override) this.updateConfig(taskId, override);
      if (retryFailed) this.prepareRetry(taskId);
      this.resetRunning(taskId);
      this.db.prepare("DELETE FROM task_queue WHERE task_id = ?").run(taskId);
      this.db
        .prepare("DELETE FROM task_controls WHERE task_id = ?")
        .run(taskId);
      this.status(taskId, "running");
    });
  }

  requestControl(taskId: string, action: "pause" | "cancel"): void {
    this.transaction(() => {
      const task = this.getTask(taskId);
      if (["completed", "cancelled"].includes(task.status))
        throw new ConflictError("任务已结束");
      if (task.status === "running") {
        const existing = this.control(taskId);
        if (existing === "cancel" && action === "pause")
          throw new ConflictError("任务正在取消");
        this.db
          .prepare(
            "INSERT INTO task_controls(task_id, action) VALUES (?, ?) ON CONFLICT(task_id) DO UPDATE SET action = excluded.action",
          )
          .run(taskId, action);
      } else {
        if (
          action === "pause" &&
          !["queued", "pending", "paused"].includes(task.status)
        )
          throw new ConflictError("此任务不能暂停，请选择继续或重试");
        this.db.prepare("DELETE FROM task_queue WHERE task_id = ?").run(taskId);
        this.status(taskId, action === "pause" ? "paused" : "cancelled");
      }
    });
  }

  control(taskId: string): "pause" | "cancel" | null {
    return (
      (this.db
        .prepare("SELECT action FROM task_controls WHERE task_id = ?")
        .get(taskId)?.action as "pause" | "cancel" | undefined) ?? null
    );
  }

  finishControl(taskId: string): void {
    this.transaction(() => {
      const action = this.control(taskId);
      if (action) {
        this.status(taskId, action === "pause" ? "paused" : "cancelled");
        this.db
          .prepare("DELETE FROM task_controls WHERE task_id = ?")
          .run(taskId);
      }
    });
  }

  saveSite(config: SiteConfig, onlyIfMissing = false): SiteRecord {
    this.db
      .prepare(
        `INSERT INTO sites(name, config, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(name) ${onlyIfMissing ? "DO NOTHING" : "DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at"}`,
      )
      .run(config.name, JSON.stringify(config), new Date().toISOString());
    return this.getSite(config.name);
  }

  getSite(name: string): SiteRecord {
    const row = this.db
      .prepare(
        "SELECT name, config, updated_at AS updatedAt FROM sites WHERE name = ?",
      )
      .get(name);
    if (!row) throw new NotFoundError(`站点不存在: ${name}`);
    return {
      name: String(row.name),
      config: siteSchema.parse(JSON.parse(String(row.config))),
      updatedAt: String(row.updatedAt),
    };
  }

  sites(): SiteRecord[] {
    return this.db
      .prepare("SELECT name FROM sites ORDER BY name")
      .all()
      .map((row) => this.getSite(String(row.name)));
  }

  chapterPage(
    bookId: string,
    offset: number,
    limit: number,
    search = "",
  ): PageResult<ChapterSummary> {
    this.getBook(bookId);
    const where =
      "book_id = ? AND active = 1 AND instr(lower(title), lower(?)) > 0";
    const total = Number(
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM chapters WHERE ${where}`)
        .get(bookId, search)!.n,
    );
    const rows = this.db
      .prepare(
        `SELECT id, book_id AS bookId, url, title, position, fetched_at AS fetchedAt,
      content IS NOT NULL AS downloaded FROM chapters WHERE ${where} ORDER BY position LIMIT ? OFFSET ?`,
      )
      .all(bookId, search, limit, offset);
    return {
      total,
      items: rows.map((row) => ({
        ...row,
        downloaded: Boolean(row.downloaded),
      })) as unknown as ChapterSummary[],
    };
  }

  chapter(bookId: string, id: string): Chapter {
    const row = this.db
      .prepare(
        `SELECT id, book_id AS bookId, url, title, position, content, fetched_at AS fetchedAt
      FROM chapters WHERE id = ? AND book_id = ?`,
      )
      .get(id, bookId);
    if (!row) throw new NotFoundError("章节不存在");
    return row as unknown as Chapter;
  }

  itemPage(
    taskId: string,
    offset: number,
    limit: number,
    status = "",
  ): PageResult<TaskItem> {
    this.getTask(taskId);
    const filter = "i.task_id = ? AND (? = '' OR i.status = ?)";
    const total = Number(
      this.db
        .prepare(`SELECT COUNT(*) AS n FROM task_items i WHERE ${filter}`)
        .get(taskId, status, status)!.n,
    );
    const items = this.db
      .prepare(
        `SELECT i.task_id AS taskId, i.chapter_id AS chapterId, i.position, i.title,
      i.status, i.attempts, i.error, c.url FROM task_items i JOIN chapters c ON c.id = i.chapter_id
      WHERE ${filter} ORDER BY i.position LIMIT ? OFFSET ?`,
      )
      .all(taskId, status, status, limit, offset) as unknown as TaskItem[];
    return { total, items };
  }

  addEvent(
    taskId: string | null,
    level: string,
    message: string,
    data: object = {},
  ): void {
    this.db
      .prepare(
        "INSERT INTO task_events(task_id, level, message, data, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        taskId,
        level,
        message,
        JSON.stringify(data),
        new Date().toISOString(),
      );
  }

  events(taskId: string, level = ""): TaskEvent[] {
    return this.db
      .prepare(
        `SELECT id, level, message, data, created_at AS createdAt FROM task_events
      WHERE task_id = ? AND (? = '' OR level = ?) ORDER BY id DESC LIMIT 100`,
      )
      .all(taskId, level, level) as unknown as TaskEvent[];
  }

  schedules(): Schedule[] {
    return this.db
      .prepare("SELECT id FROM schedules ORDER BY next_run_at")
      .all()
      .map((row) => this.getSchedule(String(row.id)));
  }

  getSchedule(id: string): Schedule {
    const row = this.db
      .prepare(
        `SELECT id, site, url, interval_minutes AS intervalMinutes, enabled,
      next_run_at AS nextRunAt, last_run_at AS lastRunAt, last_task_id AS lastTaskId, error FROM schedules WHERE id = ?`,
      )
      .get(id);
    if (!row) throw new NotFoundError("定时计划不存在");
    return { ...row, enabled: Boolean(row.enabled) } as unknown as Schedule;
  }

  createSchedule(site: string, url: string, intervalMinutes: number): Schedule {
    this.getSite(site);
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO schedules(id, site, url, interval_minutes, next_run_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        id,
        site,
        canonicalUrl(url),
        intervalMinutes,
        Date.now() + intervalMinutes * 60_000,
      );
    return this.getSchedule(id);
  }

  setScheduleEnabled(id: string, enabled: boolean): Schedule {
    const current = this.getSchedule(id);
    this.db
      .prepare(
        "UPDATE schedules SET enabled = ?, next_run_at = ?, error = NULL WHERE id = ?",
      )
      .run(
        Number(enabled),
        enabled
          ? Date.now() + current.intervalMinutes * 60_000
          : current.nextRunAt,
        id,
      );
    return this.getSchedule(id);
  }

  deleteSchedule(id: string): void {
    this.getSchedule(id);
    this.db.prepare("DELETE FROM schedules WHERE id = ?").run(id);
  }

  queueSchedule(id: string, now = Date.now(), force = false): Task | null {
    const schedule = this.getSchedule(id);
    if (!force && (!schedule.enabled || schedule.nextRunAt > now)) return null;
    try {
      return this.transaction(() => {
        const current = this.getSchedule(id);
        if (!force && (!current.enabled || current.nextRunAt > now))
          return null;
        const task = this.insertTask(
          this.getSite(current.site).config,
          current.url,
          false,
        );
        this.putQueue(task.id, "resume");
        this.db
          .prepare(
            "UPDATE schedules SET next_run_at = ?, last_run_at = ?, last_task_id = ?, error = NULL WHERE id = ?",
          )
          .run(now + current.intervalMinutes * 60_000, now, task.id, id);
        return this.getTask(task.id);
      });
    } catch (error) {
      this.db
        .prepare(
          "UPDATE schedules SET next_run_at = ?, last_run_at = ?, error = ? WHERE id = ?",
        )
        .run(
          now + schedule.intervalMinutes * 60_000,
          now,
          error instanceof Error ? error.message : String(error),
          id,
        );
      throw error;
    }
  }

  createExport(
    bookId: string,
    format: "txt" | "json",
    filename: string,
  ): ExportRecord {
    this.getBook(bookId);
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO exports(id, book_id, format, status, filename, created_at) VALUES (?, ?, ?, 'running', ?, ?)",
      )
      .run(id, bookId, format, filename, new Date().toISOString());
    return this.getExport(id);
  }

  finishExport(
    id: string,
    missing: number,
    error: string | null = null,
  ): ExportRecord {
    this.db
      .prepare(
        "UPDATE exports SET status = ?, missing = ?, error = ? WHERE id = ?",
      )
      .run(error ? "failed" : "completed", missing, error, id);
    return this.getExport(id);
  }

  recoverExports(): void {
    this.db
      .prepare(
        "UPDATE exports SET status = 'failed', error = '服务重启，请重新导出' WHERE status = 'running'",
      )
      .run();
  }

  getExport(id: string): ExportRecord {
    const row = this.db
      .prepare(
        `SELECT e.id, e.book_id AS bookId, b.title, e.format, e.status, e.missing,
      e.filename, e.error, e.created_at AS createdAt FROM exports e JOIN books b ON b.id = e.book_id WHERE e.id = ?`,
      )
      .get(id);
    if (!row) throw new NotFoundError("导出记录不存在");
    return row as unknown as ExportRecord;
  }

  exports(): ExportRecord[] {
    return this.db
      .prepare(
        "SELECT id FROM exports ORDER BY created_at DESC, rowid DESC LIMIT 100",
      )
      .all()
      .map((row) => this.getExport(String(row.id)));
  }

  stats() {
    const count = (sql: string) => Number(this.db.prepare(sql).get()!.n);
    return {
      books: count("SELECT COUNT(*) AS n FROM books"),
      chapters: count("SELECT COUNT(*) AS n FROM chapters WHERE active = 1"),
      downloaded: count(
        "SELECT COUNT(*) AS n FROM chapters WHERE active = 1 AND content IS NOT NULL",
      ),
      running: count(
        "SELECT COUNT(*) AS n FROM tasks WHERE status = 'running'",
      ),
      queued: count("SELECT COUNT(*) AS n FROM tasks WHERE status = 'queued'"),
      failed: count("SELECT COUNT(*) AS n FROM tasks WHERE status = 'failed'"),
      completed: count(
        "SELECT COUNT(*) AS n FROM tasks WHERE status = 'completed'",
      ),
    };
  }

  close(): void {
    this.db.close();
  }
}
