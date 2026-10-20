import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { exportBook, safeFilename } from "../src/exporters/book.js";
import { Store } from "../src/infrastructure/storage/store.js";
import { catalog, config } from "./helpers.js";

let dir: string;
let store: Store;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "crawler-export-"));
  store = new Store(":memory:");
});
afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

it("缺章拒绝导出且不破坏已有文件；允许部分导出时标记缺章", async () => {
  const task = store.createTask(config, "https://example.test/book");
  store.saveCatalog(task.id, "测试小说", catalog.chapters, false);
  store.succeed(task.id, store.items(task.id)[0]!.chapterId, "第一章正文");
  const output = join(dir, "existing.txt");
  await writeFile(output, "原有完整文件");
  await expect(
    exportBook(store, task.bookId, { format: "txt", outputDir: dir, output }),
  ).rejects.toThrow("缺少 1 个章节");
  expect(await readFile(output, "utf8")).toBe("原有完整文件");
  const result = await exportBook(store, task.bookId, {
    format: "txt",
    outputDir: dir,
    output,
    allowPartial: true,
  });
  expect(result.missing).toBe(1);
  expect(await readFile(output, "utf8")).toContain("【本章尚未采集】");
  expect(await readdir(dir)).toEqual(["existing.txt"]);
});

it("TXT 和 JSON 保留目录顺序，文件名不会逃逸输出目录", async () => {
  const task = store.createTask(config, "https://example.test/book");
  store.saveCatalog(task.id, "../../测试/小说", catalog.chapters, false);
  const items = store.items(task.id);
  store.succeed(task.id, items[1]!.chapterId, "第二章正文");
  store.succeed(task.id, items[0]!.chapterId, "序章正文");
  const txt = await exportBook(store, task.bookId, {
    format: "txt",
    outputDir: dir,
  });
  expect(txt.path.startsWith(`${dir}/`)).toBe(true);
  expect(await readFile(txt.path, "utf8")).toMatch(/序章正文[\s\S]*第二章正文/);
  const json = await exportBook(store, task.bookId, {
    format: "json",
    outputDir: dir,
  });
  expect(JSON.parse(await readFile(json.path, "utf8"))).toMatchObject({
    incomplete: false,
    missing: [],
    chapters: [{ position: 0 }, { position: 1 }],
  });
  expect(safeFilename(".../")).not.toContain("/");
});

it("长中文书名按字节限制文件名，兼容保留设备名", async () => {
  const task = store.createTask(config, "https://example.test/long");
  store.saveCatalog(task.id, "长书名".repeat(100), catalog.chapters, false);
  for (const item of store.items(task.id))
    store.succeed(task.id, item.chapterId, "正文");
  const result = await exportBook(store, task.bookId, {
    format: "txt",
    outputDir: dir,
  });
  expect(await readFile(result.path, "utf8")).toContain("正文");
  expect(
    Buffer.byteLength(safeFilename("中文".repeat(100))),
  ).toBeLessThanOrEqual(160);
  expect(safeFilename("CON")).toBe("_CON");
});
