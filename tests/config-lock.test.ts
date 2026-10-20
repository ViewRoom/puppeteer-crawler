import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { canonicalUrl, loadSites, siteSchema } from "../src/adapters/config.js";
import { acquireRunLock } from "../src/infrastructure/storage/lock.js";
import { config } from "./helpers.js";

const dirs: string[] = [];
function directory() {
  const dir = mkdtempSync(join(tmpdir(), "crawler-config-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  dirs.length = 0;
});

it("配置默认值与 HTTP URL 校验，拒绝未知字段和越界并发", () => {
  expect(
    siteSchema.parse({
      name: "new",
      selectors: { chapterList: "a", chapterContent: "main" },
    }).request.retries,
  ).toBe(3);
  expect(() => siteSchema.parse({ ...config, concurrency: 0 })).toThrow();
  expect(() => siteSchema.parse({ ...config, typo: true })).toThrow();
  expect(() =>
    siteSchema.parse({ ...config, baseUrls: ["file:///tmp/a"] }),
  ).toThrow();
  expect(canonicalUrl("/chapter#top", "https://example.test/book")).toBe(
    "https://example.test/chapter",
  );
});

it("自定义 JSON 同名覆盖内置站点，无需修改源码", async () => {
  const path = join(directory(), "sites.json");
  writeFileSync(path, JSON.stringify({ ...config, name: "deqixs" }));
  const sites = await loadSites(path);
  expect(sites).toHaveLength(4);
  expect(
    sites.find((site) => site.name === "deqixs")?.selectors.chapterContent,
  ).toBe("#content");
});

it("采集进程互斥且能恢复死进程留下的锁", () => {
  const path = join(directory(), "crawler.sqlite");
  const release = acquireRunLock(path);
  expect(() => acquireRunLock(path)).toThrow("已有采集进程");
  release();
  const db = new DatabaseSync(path);
  db.prepare("INSERT INTO run_lock(id, pid, token) VALUES (1, ?, 'stale')").run(
    1_000_000_000,
  );
  db.close();
  const releaseRecovered = acquireRunLock(path);
  expect(() => acquireRunLock(path)).toThrow("已有采集进程");
  releaseRecovered();
});
