import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CrawlService } from "../src/application/crawl.js";
import { Store } from "../src/infrastructure/storage/store.js";
import { CrawlError } from "../src/domain/errors.js";
import { catalog, config, signal, silent } from "./helpers.js";

const stores: Store[] = [];
const dirs: string[] = [];
const memory = () => {
  const store = new Store(":memory:");
  stores.push(store);
  return store;
};
afterEach(() => {
  stores.forEach((store) => store.close());
  stores.length = 0;
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  dirs.length = 0;
});

describe("采集任务", () => {
  it("章节失败保留成功内容，retry 只补采失败章节，随后增量采集只抓新增内容", async () => {
    const store = memory();
    let failing = true;
    const read = vi.fn(async (url: string) => {
      if (url.endsWith("/2") && failing) throw new Error("临时故障");
      return `正文 ${url}`;
    });
    const source = {
      discover: vi.fn(async () => structuredClone(catalog)),
      readChapter: read,
      close: vi.fn(async () => {}),
    };
    const service = new CrawlService(store, silent, async () => source);
    const first = await service.start(
      config,
      "https://example.test/book#top",
      signal(),
    );
    expect(first).toMatchObject({ status: "failed", succeeded: 1, failed: 1 });
    expect(
      store.chapters(first.bookId).map((chapter) => chapter.content),
    ).toEqual(["正文 https://example.test/1", null]);
    expect(store.items(first.id)[1]?.attempts).toBe(2);
    expect(source.close).toHaveBeenCalledOnce();
    failing = false;
    read.mockClear();
    const retried = await service.run(first.id, signal(), true);
    expect(retried).toMatchObject({
      status: "completed",
      succeeded: 2,
      failed: 0,
    });
    expect(read.mock.calls.map(([url]) => url)).toEqual([
      "https://example.test/2",
    ]);
    source.discover.mockResolvedValue({
      ...catalog,
      chapters: [
        ...catalog.chapters,
        { url: "https://example.test/3", title: "番外", position: 2 },
      ],
    });
    read.mockClear();
    const incremental = await service.start(
      config,
      "https://example.test/book",
      signal(),
    );
    expect(incremental).toMatchObject({
      status: "completed",
      succeeded: 1,
      skipped: 2,
      total: 3,
    });
    expect(read.mock.calls.map(([url]) => url)).toEqual([
      "https://example.test/3",
    ]);
    expect(store.chapters(first.bookId)).toHaveLength(3);
  });

  it("中断保留已完成章节，重新打开数据库后 resume 不重抓成功章节", async () => {
    const dir = mkdtempSync(join(tmpdir(), "crawler-resume-"));
    dirs.push(dir);
    const database = join(dir, "crawler.sqlite");
    const store = new Store(database);
    const controller = new AbortController();
    const source = {
      discover: vi.fn(async () => catalog),
      readChapter: vi.fn(async (url: string) => {
        if (url.endsWith("/2")) {
          controller.abort(new Error("用户停止"));
          throw new Error("aborted");
        }
        return "已完成的正文";
      }),
      close: vi.fn(async () => {}),
    };
    const first = await new CrawlService(
      store,
      silent,
      async () => source,
    ).start(
      { ...config, concurrency: 1 },
      "https://example.test/book",
      controller.signal,
    );
    expect(first).toMatchObject({
      status: "interrupted",
      succeeded: 1,
      pending: 1,
      failed: 0,
    });
    store.close();
    const reopened = new Store(database);
    stores.push(reopened);
    const read = vi.fn(async () => "恢复的正文");
    const resumed = await new CrawlService(reopened, silent, async () => ({
      ...source,
      readChapter: read,
    })).run(first.id, signal());
    expect(resumed).toMatchObject({ status: "completed", succeeded: 2 });
    expect(read).toHaveBeenCalledExactlyOnceWith(
      "https://example.test/2",
      expect.any(AbortSignal),
    );
    expect(source.discover).toHaveBeenCalledOnce();
  });

  it("refresh 失败仍保留旧正文，永久错误不自动重试", async () => {
    const store = memory();
    const read = vi.fn(async () => "旧正文");
    const source = {
      discover: async () => catalog,
      readChapter: read,
      close: async () => {},
    };
    const service = new CrawlService(store, silent, async () => source);
    const initial = await service.start(
      config,
      "https://example.test/book",
      signal(),
    );
    read.mockRejectedValue(new CrawlError("HTTP 404", false));
    read.mockClear();
    const refreshed = await service.start(
      config,
      "https://example.test/book",
      signal(),
      true,
    );
    expect(refreshed).toMatchObject({
      status: "failed",
      failed: 2,
      skipped: 0,
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(
      store
        .chapters(initial.bookId)
        .every((chapter) => chapter.content === "旧正文"),
    ).toBe(true);
  });

  it("分页失败不会覆盖已保存的完整目录和正文", async () => {
    const store = memory();
    const discover = vi.fn(async () => catalog);
    const source = {
      discover,
      readChapter: async () => "正文",
      close: async () => {},
    };
    const service = new CrawlService(store, silent, async () => source);
    const initial = await service.start(
      config,
      "https://example.test/book",
      signal(),
    );
    discover.mockRejectedValue(new Error("目录分页失败"));
    const failed = await service.start(
      config,
      "https://example.test/book",
      signal(),
    );
    expect(failed).toMatchObject({ status: "failed", catalogComplete: 0 });
    expect(store.chapters(initial.bookId)).toHaveLength(2);
    expect(
      store
        .chapters(initial.bookId)
        .every((chapter) => chapter.content === "正文"),
    ).toBe(true);
  });

  it("并发受限，逆序完成时仍按目录顺序保存", async () => {
    const store = memory();
    let active = 0;
    let peak = 0;
    const chapters = Array.from({ length: 10 }, (_, position) => ({
      url: `https://example.test/${position}`,
      title: `第${position}章`,
      position,
    }));
    const source = {
      discover: async () => ({ title: "顺序测试", chapters }),
      readChapter: async (url: string) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) =>
          setTimeout(resolve, url.endsWith("/0") ? 30 : 1),
        );
        active--;
        return url;
      },
      close: async () => {},
    };
    const result = await new CrawlService(
      store,
      silent,
      async () => source,
    ).start(config, "https://example.test/book", signal());
    expect(peak).toBe(2);
    expect(result.status).toBe("completed");
    expect(
      store.chapters(result.bookId).map((chapter) => chapter.content),
    ).toEqual(chapters.map((chapter) => chapter.url));
  });

  it("异常退出的 running 状态可恢复，未完成任务不允许重复创建", () => {
    const store = memory();
    const task = store.createTask(config, "https://example.test/book");
    store.saveCatalog(task.id, catalog.title, catalog.chapters, false);
    store.status(task.id, "running");
    store.attempt(task.id, store.items(task.id)[0]!.chapterId);
    store.recoverInterrupted();
    expect(store.getTask(task.id).status).toBe("interrupted");
    expect(store.items(task.id)[0]?.status).toBe("pending");
    expect(() => store.createTask(config, "https://example.test/book")).toThrow(
      task.id,
    );
  });

  it("修复站点配置后可以补采，并保存新的恢复配置", async () => {
    const store = memory();
    const factory = vi.fn(async (currentConfig) => ({
      discover: async () => catalog,
      readChapter: async () => {
        if (currentConfig.selectors.chapterContent === "#content")
          throw new CrawlError("选择器已过期", false);
        return "修复后的正文";
      },
      close: async () => {},
    }));
    const service = new CrawlService(store, silent, factory);
    const task = await service.start(
      config,
      "https://example.test/book",
      signal(),
    );
    const updated = {
      ...config,
      selectors: { ...config.selectors, chapterContent: ".new-content" },
    };
    const result = await service.run(task.id, signal(), true, updated);
    expect(result).toMatchObject({ status: "completed", succeeded: 2 });
    expect(
      JSON.parse(store.getTask(task.id).siteConfig).selectors.chapterContent,
    ).toBe(".new-content");
  });
});
