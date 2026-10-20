import { createServer, type Server } from "node:http";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { siteSchema, type SiteConfig } from "../src/adapters/config.js";
import { BrowserSource } from "../src/infrastructure/browser/source.js";
import { Store } from "../src/infrastructure/storage/store.js";
import { config, signal } from "./helpers.js";

let server: Server;
let base: string;
let site: SiteConfig;
let failChapter = false;
let dir: string;
const directories: string[] = [];
let hangChapter = false;
let slowStarted = Promise.withResolvers<void>();
const requests = new Map<string, number>();

async function cli(
  ...args: string[]
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      resolve("src/cli/index.ts"),
      "--data-dir",
      dir,
      ...args,
    ],
    {
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 25_000);
  try {
    const [code] = (await once(child, "close")) as [number | null];
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timeout);
  }
}

beforeAll(async () => {
  const fixtures = new Map(
    await Promise.all(
      ["catalog", "catalog-page2", "chapter", "chapter-page2"].map(
        async (name) =>
          [
            name,
            await readFile(
              new URL(`./fixtures/${name}.html`, import.meta.url),
              "utf8",
            ),
          ] as const,
      ),
    ),
  );
  server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    requests.set(url.pathname, (requests.get(url.pathname) || 0) + 1);
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    if (url.pathname === "/catalog")
      response.end(
        fixtures.get(
          url.searchParams.has("page") ? "catalog-page2" : "catalog",
        ),
      );
    else if (url.pathname === "/chapter/1")
      response.end(
        fixtures.get(
          url.searchParams.has("page") ? "chapter-page2" : "chapter",
        ),
      );
    else if (url.pathname === "/chapter/2") {
      response.statusCode = failChapter ? 503 : 200;
      response.end(
        failChapter ? "暂时不可用" : '<div id="content">番外正文。</div>',
      );
    } else if (url.pathname === "/static-redirect") {
      response.writeHead(302, { location: "/static-script" });
      response.end();
    } else if (url.pathname === "/static-script") {
      response.end(
        '<h1>原始书名</h1><div class="chapters"><a href="chapter/1">序章</a></div><img src="/should-not-load"><script>document.querySelector("h1").textContent = "脚本改写";</script>',
      );
    } else if (url.pathname === "/slow-book") {
      response.end(
        '<h1>中断测试</h1><div class="chapters"><a href="/chapter/1">序章</a><a href="/slow">第二章</a></div>',
      );
    } else if (url.pathname === "/slow") {
      if (hangChapter) slowStarted.resolve();
      else response.end('<div id="content">恢复后的正文</div>');
    } else if (url.pathname === "/loop")
      response.end(
        '<h1>循环</h1><div class="chapters"><a href="/chapter/1">序章</a></div><a class="next" href="/loop">下一页</a><div id="content">正文</div>',
      );
    else {
      response.statusCode = 404;
      response.end("Not Found");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("测试服务器启动失败");
  base = `http://127.0.0.1:${address.port}`;
  site = siteSchema.parse({
    ...config,
    selectors: { ...config.selectors, remove: [".ad"] },
    pagination: {
      catalog: { selector: ".next", maxPages: 5 },
      content: { selector: ".next", text: "下一页", maxPages: 5 },
    },
  });
});
beforeEach(async () => {
  requests.clear();
  failChapter = false;
  hangChapter = false;
  slowStarted = Promise.withResolvers<void>();
  dir = await mkdtemp(join(tmpdir(), "crawler-browser-"));
  directories.push(dir);
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  await Promise.all(
    directories.map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("真实 Chromium 与本地页面", () => {
  it("HTTP 模式保留重定向后的相对链接、分页和正文，且不执行脚本或加载资源", async () => {
    const source = await BrowserSource.create(
      { ...site, transport: "http" },
      signal(),
    );
    try {
      const catalog = await source.discover(`${base}/catalog`, signal());
      expect(catalog.chapters.map((chapter) => chapter.url)).toEqual([
        `${base}/chapter/1`,
        `${base}/chapter/2`,
      ]);
      expect(
        await source.readChapter(catalog.chapters[0]!.url, signal()),
      ).toMatch(/第一段正文[\s\S]*第二段正文/);
      const redirected = await source.discover(
        `${base}/static-redirect`,
        signal(),
      );
      expect(redirected.title).toBe("原始书名");
      expect(redirected.chapters[0]?.url).toBe(`${base}/chapter/1`);
      expect(requests.get("/should-not-load")).toBeUndefined();
      await expect(
        source.readChapter(`${base}/missing`, signal()),
      ).rejects.toMatchObject({ retryable: false });
      failChapter = true;
      await expect(
        source.readChapter(`${base}/chapter/2`, signal()),
      ).rejects.toMatchObject({ retryable: true });
    } finally {
      await source.close();
    }
  });

  it("解析目录与正文分页，去重链接、保留序章番外、移除广告且不串入下一章", async () => {
    const source = await BrowserSource.create(site, signal());
    try {
      const catalog = await source.discover(`${base}/catalog`, signal());
      expect(catalog.title).toBe("测试小说");
      expect(catalog.chapters.map(({ title }) => title)).toEqual([
        "序章",
        "番外",
      ]);
      const content = await source.readChapter(`${base}/chapter/1`, signal());
      expect(content).toContain("第一段正文。");
      expect(content).toContain("第二段正文。");
      expect(content).not.toContain("广告");
      expect(requests.get("/chapter/2")).toBeUndefined();
    } finally {
      await source.close();
    }
  });

  it("目录循环、正文循环与分页上限都显式失败", async () => {
    const source = await BrowserSource.create(site, signal());
    try {
      await expect(source.discover(`${base}/loop`, signal())).rejects.toThrow(
        "目录分页发生循环",
      );
      await expect(
        source.readChapter(`${base}/loop`, signal()),
      ).rejects.toThrow("正文分页发生循环");
    } finally {
      await source.close();
    }
    const limited = await BrowserSource.create(
      { ...site, pagination: { catalog: { selector: ".next", maxPages: 1 } } },
      signal(),
    );
    try {
      await expect(
        limited.discover(`${base}/catalog`, signal()),
      ).rejects.toThrow("maxPages");
    } finally {
      await limited.close();
    }
  });

  it("CLI 采集失败返回非零状态，跨进程补采、增量跳过、TXT/JSON 导出", async () => {
    const configPath = join(dir, "site.json");
    await writeFile(configPath, JSON.stringify(site));
    failChapter = true;
    const failed = await cli(
      "--config",
      configPath,
      "crawl",
      "--site",
      "test",
      "--url",
      `${base}/catalog`,
    );
    expect(failed.code, failed.stderr).toBe(1);
    let store = new Store(join(dir, "crawler.sqlite"));
    const task = store.listTasks()[0]!;
    expect(task).toMatchObject({ status: "failed", succeeded: 1, failed: 1 });
    store.close();
    expect(requests.get("/chapter/2")).toBe(2);
    const firstChapterRequests = requests.get("/chapter/1");
    failChapter = false;
    const retried = await cli("retry", task.id, "--failed");
    expect(retried.code, retried.stderr).toBe(0);
    expect(requests.get("/chapter/1")).toBe(firstChapterRequests);
    const incremental = await cli(
      "--config",
      configPath,
      "crawl",
      "--site",
      "test",
      "--url",
      `${base}/catalog`,
    );
    expect(incremental.code, incremental.stderr).toBe(0);
    store = new Store(join(dir, "crawler.sqlite"));
    expect(store.listTasks().find((item) => item.id !== task.id)).toMatchObject(
      { status: "completed", skipped: 2, succeeded: 0 },
    );
    store.close();
    const output = join(dir, "book.txt");
    expect((await cli("export", task.bookId, "--output", output)).code).toBe(0);
    expect(await readFile(output, "utf8")).toMatch(
      /第一段正文[\s\S]*第二段正文[\s\S]*番外正文/,
    );
    const jsonPath = join(dir, "book.json");
    expect(
      (
        await cli(
          "export",
          task.bookId,
          "--format",
          "json",
          "--output",
          jsonPath,
        )
      ).code,
    ).toBe(0);
    expect(JSON.parse(await readFile(jsonPath, "utf8")).chapters).toHaveLength(
      2,
    );
  });

  it.each(["SIGTERM", "SIGKILL"] as const)(
    "CLI 收到 %s 后跨进程恢复，不重抓已完成章节",
    async (stopSignal) => {
      const configPath = join(dir, "site.json");
      await writeFile(configPath, JSON.stringify({ ...site, concurrency: 1 }));
      hangChapter = true;
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          resolve("src/cli/index.ts"),
          "--data-dir",
          dir,
          "--config",
          configPath,
          "crawl",
          "--site",
          "test",
          "--url",
          `${base}/slow-book`,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stderr = "";
      child.stdout.resume();
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const ended = once(child, "close");
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          slowStarted.promise,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error(`等待慢章节超时: ${stderr}`)),
              15_000,
            );
          }),
        ]);
        if (timeout) clearTimeout(timeout);
        child.kill(stopSignal);
        const [code, terminatedBy] = await ended;
        if (stopSignal === "SIGTERM") expect(code, stderr).toBe(130);
        else expect(terminatedBy).toBe("SIGKILL");
        let store = new Store(join(dir, "crawler.sqlite"));
        const task = store.listTasks()[0]!;
        expect(task).toMatchObject({
          status: stopSignal === "SIGTERM" ? "interrupted" : "running",
          succeeded: 1,
          pending: 1,
        });
        store.close();
        const firstRequests = requests.get("/chapter/1");
        hangChapter = false;
        const resumed = await cli("resume", task.id);
        expect(resumed.code, resumed.stderr).toBe(0);
        expect(requests.get("/chapter/1")).toBe(firstRequests);
        store = new Store(join(dir, "crawler.sqlite"));
        expect(store.summary(task.id)).toMatchObject({
          status: "completed",
          succeeded: 2,
        });
        store.close();
      } finally {
        if (timeout) clearTimeout(timeout);
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
        await ended;
      }
    },
  );
});
