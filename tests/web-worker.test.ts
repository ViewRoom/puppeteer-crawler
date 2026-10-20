import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { siteSchema } from "../src/adapters/config.js";
import { acquireRunLock } from "../src/infrastructure/storage/lock.js";
import { config } from "./helpers.js";

let server: Server;
let base: string;
let hang = false;
let failing = false;
let secondStarted = Promise.withResolvers<void>();
let firstRequests = 0;
beforeAll(async () => {
  server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    if (request.url === "/book")
      response.end(
        '<h1>Worker 集成小说</h1><div class="chapters"><a href="/1">序章</a><a href="/2">第二章</a></div>',
      );
    else if (request.url === "/1") {
      firstRequests++;
      response.end('<div id="content">第一章正文。</div>');
    } else if (request.url === "/2") {
      secondStarted.resolve();
      if (hang) return;
      response.statusCode = failing ? 503 : 200;
      response.end(
        failing ? "暂时不可用" : '<div id="content">第二章正文。</div>',
      );
    } else {
      response.statusCode = 404;
      response.end("not found");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fixture server failed");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("独立 Worker 与管理 API", () => {
  it("跨进程预览、暂停恢复、补采、计划入队和完整导出", async () => {
    const dir = await mkdtemp(join(tmpdir(), "crawler-worker-"));
    const runtime = await createApp({ dataDir: dir, serveWeb: false });
    const { app, store } = runtime;
    const site = siteSchema.parse({
      ...config,
      transport: "http",
      concurrency: 1,
      request: { ...config.request, retries: 0, timeoutMs: 10000 },
    });
    try {
      await app.ready();
      await expect
        .poll(() => runtime.workerState().status, { timeout: 10000 })
        .toBe("ready");
      await app.inject({
        method: "PUT",
        url: "/api/sites/test",
        payload: site,
      });
      const preview = await app.inject({
        method: "POST",
        url: "/api/sites/preview",
        payload: { config: site, url: `${base}/book` },
      });
      expect(preview.statusCode, preview.body).toBe(200);
      expect(preview.json()).toMatchObject({
        title: "Worker 集成小说",
        total: 2,
        sample: { text: "第一章正文。" },
      });
      expect(store.listBooks()).toHaveLength(0);
      firstRequests = 0;
      hang = true;
      secondStarted = Promise.withResolvers<void>();
      const created = await app.inject({
        method: "POST",
        url: "/api/tasks",
        payload: { site: "test", url: `${base}/book` },
      });
      expect(created.statusCode).toBe(201);
      const task = created.json();
      await expect
        .poll(() => store.summary(task.id).succeeded, { timeout: 10000 })
        .toBe(1);
      await secondStarted.promise;
      await app.inject({
        method: "POST",
        url: `/api/tasks/${task.id}/pause`,
        payload: {},
      });
      await expect
        .poll(() => store.summary(task.id).status, { timeout: 10000 })
        .toBe("paused");
      expect(store.summary(task.id)).toMatchObject({
        succeeded: 1,
        pending: 1,
        control: null,
      });
      hang = false;
      await app.inject({
        method: "POST",
        url: `/api/tasks/${task.id}/resume`,
        payload: {},
      });
      await expect
        .poll(() => store.summary(task.id).status, { timeout: 10000 })
        .toBe("completed");
      expect(firstRequests).toBe(1);
      const exported = await app.inject({
        method: "POST",
        url: "/api/exports",
        payload: { bookId: task.bookId, format: "txt" },
      });
      expect(exported.statusCode).toBe(201);
      const download = await app.inject(
        `/api/exports/${exported.json().id}/download`,
      );
      expect(download.body).toMatch(
        /序章[\s\S]*第一章正文[\s\S]*第二章[\s\S]*第二章正文/,
      );
      expect(
        store.events(task.id).some((event) => event.message === "章节已保存"),
      ).toBe(true);
      failing = true;
      const next = (
        await app.inject({
          method: "POST",
          url: "/api/tasks",
          payload: { site: "test", url: `${base}/book`, refresh: true },
        })
      ).json();
      await expect
        .poll(() => store.summary(next.id).status, { timeout: 10000 })
        .toBe("failed");
      expect(store.summary(next.id).failed).toBe(1);
      const requestsBeforeRetry = firstRequests;
      failing = false;
      await app.inject({
        method: "POST",
        url: `/api/tasks/${next.id}/retry`,
        payload: {},
      });
      await expect
        .poll(() => store.summary(next.id).status, { timeout: 10000 })
        .toBe("completed");
      expect(firstRequests).toBe(requestsBeforeRetry);
      const schedule = store.createSchedule("test", `${base}/book`, 5);
      // Let the actual timer enqueue this overdue schedule, rather than calling queueSchedule directly.
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(join(dir, "crawler.sqlite"));
      db.prepare("UPDATE schedules SET next_run_at = ? WHERE id = ?").run(
        Date.now() - 1000,
        schedule.id,
      );
      db.close();
      await expect
        .poll(() => store.getSchedule(schedule.id).lastTaskId, {
          timeout: 5000,
        })
        .not.toBeNull();
      const scheduledTask = store.getSchedule(schedule.id).lastTaskId!;
      await expect
        .poll(() => store.summary(scheduledTask).status, { timeout: 10000 })
        .toBe("completed");
      expect(store.summary(scheduledTask).skipped).toBe(2);
      expect(firstRequests).toBe(requestsBeforeRetry);
    } finally {
      hang = false;
      failing = false;
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);

  it("CLI 占锁时保留队列，退出后自动开始采集", async () => {
    const dir = await mkdtemp(join(tmpdir(), "crawler-worker-lock-"));
    let release: (() => void) | undefined = acquireRunLock(
      join(dir, "crawler.sqlite"),
    );
    const runtime = await createApp({ dataDir: dir, serveWeb: false });
    try {
      runtime.store.saveSite(
        siteSchema.parse({ ...config, transport: "http" }),
      );
      const task = runtime.store.createQueuedTask(
        runtime.store.getSite("test").config,
        `${base}/book`,
      );
      await runtime.app.ready();
      await expect
        .poll(() => runtime.workerState().status, { timeout: 10000 })
        .toBe("blocked");
      expect(runtime.store.summary(task.id).status).toBe("queued");
      release();
      release = undefined;
      await expect
        .poll(() => runtime.store.summary(task.id).status, { timeout: 15000 })
        .toBe("completed");
    } finally {
      release?.();
      await runtime.app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
