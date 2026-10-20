import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { Store } from "../src/infrastructure/storage/store.js";
import { config, catalog } from "./helpers.js";

describe("Web 持久化队列与迁移", () => {
  it("升级 v1 保留正文和任务，并恢复自定义站点配置", async () => {
    const dir = await mkdtemp(join(tmpdir(), "crawler-migration-"));
    const path = join(dir, "crawler.sqlite");
    try {
      let store = new Store(path);
      const task = store.createTask(config, "https://example.test/book");
      store.saveCatalog(task.id, catalog.title, catalog.chapters, false);
      store.succeed(
        task.id,
        store.items(task.id)[0]!.chapterId,
        "已保存的旧正文",
      );
      store.status(task.id, "interrupted");
      const before = store.summary(task.id);
      store.close();
      // v1's four data tables are unchanged; remove all v2 extensions.
      const legacy = new DatabaseSync(path);
      legacy.exec(`DROP TABLE exports; DROP TABLE schedules; DROP TABLE task_events;
        DROP TABLE task_controls; DROP TABLE task_queue; DROP TABLE sites;
        DROP INDEX task_book_active; PRAGMA user_version = 1;`);
      legacy.close();
      store = new Store(path);
      expect(store.summary(task.id)).toEqual(before);
      expect(store.chapters(task.bookId)[0]?.content).toBe("已保存的旧正文");
      expect(store.getSite("test").config).toEqual(config);
      store.enqueue(task.id, "resume");
      store.close();
      store = new Store(path);
      expect(store.nextJob()).toEqual({ taskId: task.id, mode: "resume" });
      store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("暂停发生在领取之前时不会误启动，取消释放同书任务限制", () => {
    const store = new Store(":memory:");
    try {
      const first = store.createQueuedTask(
        config,
        "https://example.test/book#fragment",
      );
      expect(store.nextJob()?.taskId).toBe(first.id);
      store.requestControl(first.id, "pause");
      expect(store.nextJob()).toBeUndefined();
      expect(() => store.beginRun(first.id, false, true)).toThrow("状态已变化");
      expect(store.summary(first.id).status).toBe("paused");
      expect(() =>
        store.createQueuedTask(config, "https://example.test/book"),
      ).toThrow("未完成任务");
      store.enqueue(first.id, "resume");
      store.beginRun(first.id, false, true);
      store.requestControl(first.id, "cancel");
      expect(() => store.requestControl(first.id, "pause")).toThrow("正在取消");
      store.recoverInterrupted();
      expect(store.summary(first.id)).toMatchObject({
        status: "cancelled",
        control: null,
      });
      const next = store.createQueuedTask(config, "https://example.test/book");
      expect(next.bookId).toBe(first.bookId);
      expect(() => store.enqueue(first.id, "resume")).toThrow();
    } finally {
      store.close();
    }
  });

  it("到期计划原子入队，重复计划记录冲突而不生成重复任务", () => {
    const store = new Store(":memory:");
    try {
      store.saveSite(config);
      const schedule = store.createSchedule(
        "test",
        "https://example.test/book",
        5,
      );
      expect(
        store.queueSchedule(schedule.id, schedule.nextRunAt - 1),
      ).toBeNull();
      const task = store.queueSchedule(schedule.id, schedule.nextRunAt)!;
      expect(store.getSchedule(schedule.id)).toMatchObject({
        lastTaskId: task.id,
        lastRunAt: schedule.nextRunAt,
        error: null,
      });
      expect(store.nextJob()?.taskId).toBe(task.id);
      const nextRun = store.getSchedule(schedule.id).nextRunAt;
      expect(() => store.queueSchedule(schedule.id, nextRun)).toThrow(
        "未完成任务",
      );
      expect(store.listTasks()).toHaveLength(1);
      expect(store.getSchedule(schedule.id).nextRunAt).toBe(nextRun + 300000);
      expect(store.getSchedule(schedule.id).error).toContain("未完成任务");
      store.setScheduleEnabled(schedule.id, false);
      expect(store.queueSchedule(schedule.id, nextRun + 900000)).toBeNull();
    } finally {
      store.close();
    }
  });
});
