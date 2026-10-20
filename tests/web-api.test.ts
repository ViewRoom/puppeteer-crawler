import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { config, catalog } from "./helpers.js";

let dir: string;
let runtime: Awaited<ReturnType<typeof createApp>>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "crawler-api-"));
  runtime = await createApp({
    dataDir: dir,
    startWorker: false,
    serveWeb: false,
  });
});
afterEach(async () => {
  await runtime.app.close();
  await rm(dir, { recursive: true, force: true });
});

describe("本机管理 API", () => {
  it("校验 Host、Origin、内容类型和参数，并为不存在资源返回 404", async () => {
    const { app } = runtime;
    expect(
      (
        await app.inject({
          url: "/api/state",
          headers: { host: "attacker.example" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/tasks",
          headers: { origin: "https://unrelated.example" },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/tasks",
          headers: { "content-type": "text/plain" },
          payload: "{}",
        })
      ).statusCode,
    ).toBe(415);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/tasks",
          payload: { site: "test", url: "file:///etc/passwd" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/tasks",
          payload: { site: "missing", url: "https://example.test/book" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          url: "/api/tasks/00000000-0000-4000-8000-000000000000",
        })
      ).statusCode,
    ).toBe(404);
    const state = await app.inject("/api/state");
    expect(state.json().sites).toHaveLength(4);
    expect(state.headers["x-frame-options"]).toBe("DENY");
    expect(state.json().stats.books).toBe(0);
  });

  it("保存规则、控制队列、管理计划并保护缺章导出和文件下载", async () => {
    const { app, store } = runtime;
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/sites/test",
          payload: config,
        })
      ).statusCode,
    ).toBe(200);
    const created = await app.inject({
      method: "POST",
      url: "/api/tasks",
      payload: { site: "test", url: "https://example.test/book" },
    });
    expect(created.statusCode).toBe(201);
    const { id, bookId } = created.json();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/tasks",
          payload: { site: "test", url: "https://example.test/book" },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/tasks/${id}/pause`,
          payload: {},
        })
      ).json().status,
    ).toBe("paused");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/tasks/${id}/resume`,
          payload: {},
        })
      ).json().status,
    ).toBe("queued");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/tasks/${id}/resume`,
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
    store.beginRun(id, false, true);
    store.saveCatalog(id, catalog.title, catalog.chapters, false);
    store.succeed(id, store.items(id)[0]!.chapterId, "第一章正文");
    store.status(id, "failed", "缺章");
    const chapters = (
      await app.inject(`/api/books/${bookId}/chapters?limit=1&offset=0`)
    ).json();
    expect(chapters.total).toBe(2);
    expect(chapters.items[0]).toMatchObject({ downloaded: true });
    expect(chapters.items[0]).not.toHaveProperty("content");
    expect(
      (
        await app.inject(
          `/api/books/${bookId}/chapters/${chapters.items[0].id}`,
        )
      ).json().content,
    ).toBe("第一章正文");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/exports",
          payload: { bookId, format: "txt" },
        })
      ).statusCode,
    ).toBe(409);
    const partial = await app.inject({
      method: "POST",
      url: "/api/exports",
      payload: { bookId, format: "json", allowPartial: true },
    });
    expect(partial.statusCode).toBe(201);
    expect(partial.json().missing).toBe(1);
    const download = await app.inject(
      `/api/exports/${partial.json().id}/download`,
    );
    expect(download.statusCode).toBe(200);
    expect(download.json().incomplete).toBe(true);
    expect(download.headers["content-disposition"]).toContain(
      "filename*=UTF-8''",
    );
    const failed = store
      .exports()
      .find((record) => record.status === "failed")!;
    expect(
      (await app.inject(`/api/exports/${failed.id}/download`)).statusCode,
    ).toBe(409);
    const schedule = await app.inject({
      method: "POST",
      url: "/api/schedules",
      payload: {
        site: "test",
        url: "https://example.test/another",
        intervalMinutes: 5,
      },
    });
    expect(schedule.statusCode).toBe(201);
    const scheduleId = schedule.json().id;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/schedules/${scheduleId}/run`,
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/schedules/${scheduleId}`,
          payload: { enabled: false },
        })
      ).json().enabled,
    ).toBe(false);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/schedules/${scheduleId}`,
        })
      ).statusCode,
    ).toBe(200);
    expect(store.schedules()).toHaveLength(0);
  });
});
