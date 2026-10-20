#!/usr/bin/env node
import { Command, Option } from "commander";
import { resolve, join } from "node:path";
import {
  loadSites,
  loadCustomSites,
  canonicalUrl,
  siteSchema,
  type SiteConfig,
} from "../adapters/config.js";
import { CrawlService } from "../application/crawl.js";
import { errorMessage } from "../domain/errors.js";
import type { TaskSummary } from "../domain/models.js";
import { exportBook } from "../exporters/book.js";
import { createLogger } from "../infrastructure/logging/logger.js";
import { acquireRunLock } from "../infrastructure/storage/lock.js";
import { Store } from "../infrastructure/storage/store.js";

const program = new Command()
  .name("crawler")
  .description("支持断点续爬、增量采集和独立导出的小说采集工具")
  .version("0.3.0")
  .option(
    "--data-dir <path>",
    "数据库与日志目录",
    process.env.CRAWLER_DATA_DIR || "./data",
  )
  .option("--config <path>", "自定义站点 JSON 配置（同名覆盖内置配置）");

function paths() {
  const dataDir = resolve(program.opts<{ dataDir: string }>().dataDir);
  return {
    dataDir,
    database: join(dataDir, "crawler.sqlite"),
    exports: join(dataDir, "exports"),
  };
}

async function withStore<T>(
  action: (store: Store) => Promise<T> | T,
): Promise<T> {
  const store = new Store(paths().database);
  try {
    return await action(store);
  } finally {
    store.close();
  }
}

async function configuredSites() {
  const managed = await withStore((store) =>
    store.sites().map((site) => site.config),
  );
  return loadSites(program.opts<{ config?: string }>().config, managed);
}

async function collecting(
  action: (
    service: CrawlService,
    store: Store,
    signal: AbortSignal,
  ) => Promise<void>,
) {
  const release = acquireRunLock(paths().database);
  const controller = new AbortController();
  const interrupt = () =>
    controller.abort(new Error("收到停止信号，进度已保留"));
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await withStore(async (store) => {
      const logging = createLogger(paths().dataDir);
      try {
        store.recoverInterrupted();
        await action(
          new CrawlService(store, logging.logger, undefined, (progress) => {
            if (progress.phase === "starting")
              console.log(`任务 ${progress.taskId} 开始，正在获取目录…`);
            else if (
              progress.phase === "catalog" ||
              progress.done % 10 === 0 ||
              progress.done === progress.total
            ) {
              console.log(
                `[${progress.taskId}] ${progress.done}/${progress.total}，跳过 ${progress.skipped}，失败 ${progress.failed}`,
              );
            }
          }),
          store,
          controller.signal,
        );
      } finally {
        logging.close();
      }
    });
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    release();
    if (controller.signal.aborted) process.exitCode = 130;
  }
}

function printTask(summary: TaskSummary) {
  console.table([
    {
      taskId: summary.id,
      bookId: summary.bookId,
      title: summary.title,
      status: summary.status,
      total: summary.total,
      succeeded: summary.succeeded,
      skipped: summary.skipped,
      failed: summary.failed,
      pending: summary.pending,
    },
  ]);
  if (summary.error) console.error(summary.error);
  if (summary.status !== "completed")
    process.exitCode = summary.status === "interrupted" ? 130 : 1;
}

program
  .command("sites")
  .description("列出站点及默认目录地址")
  .action(async () => {
    const sites = await configuredSites();
    console.table(
      sites.map((site) => ({
        name: site.name,
        concurrency: site.concurrency,
        urls: site.baseUrls.join("\n"),
      })),
    );
  });

program
  .command("crawl")
  .description("采集书籍，已有正文默认跳过；完成后使用 export 导出")
  .option("--site <name>", "站点名称")
  .option("--url <url>", "覆盖站点的默认目录地址")
  .option("--all", "顺序采集所有站点的默认书籍")
  .option("--refresh", "重新采集已有章节，失败时保留旧正文")
  .option("--concurrency <number>", "并发页面数，1–20")
  .action(
    async (options: {
      site?: string;
      url?: string;
      all?: boolean;
      refresh?: boolean;
      concurrency?: string;
    }) => {
      if (Boolean(options.site) === Boolean(options.all))
        throw new Error("请指定 --site <name> 或 --all，两者只能选一个");
      if (options.all && options.url)
        throw new Error("--url 只能与 --site 一起使用");
      const sites = await configuredSites();
      let selected = options.all
        ? sites
        : sites.filter((site) => site.name === options.site);
      if (!selected.length)
        throw new Error(`不支持的站点: ${options.site}，可用 sites 查看`);
      selected = selected.map((site) =>
        siteSchema.parse({
          ...site,
          ...(options.concurrency !== undefined
            ? { concurrency: Number(options.concurrency) }
            : {}),
        }),
      );
      const jobs: { config: SiteConfig; url: string }[] = selected.flatMap(
        (config) =>
          (options.url ? [options.url] : config.baseUrls).map((url) => ({
            config,
            url: canonicalUrl(url),
          })),
      );
      if (!jobs.length)
        throw new Error("站点未配置 baseUrls，请使用 --url 指定目录地址");
      await collecting(async (service, _store, signal) => {
        for (const job of jobs) {
          if (signal.aborted) break;
          printTask(
            await service.start(job.config, job.url, signal, options.refresh),
          );
        }
      });
    },
  );

program
  .command("tasks")
  .description("列出最近 50 个任务")
  .argument("[taskId]", "查看任务详情和失败章节")
  .action(async (id?: string) => {
    await withStore((store) => {
      if (id) {
        console.log(JSON.stringify(store.summary(id), null, 2));
        console.table(
          store
            .items(id)
            .filter(
              (item) => item.status === "failed" || item.status === "pending",
            )
            .map(({ title, status, attempts, error, url }) => ({
              title,
              status,
              attempts,
              error,
              url,
            })),
        );
      } else {
        console.table(
          store
            .listTasks()
            .map(
              ({
                id,
                title,
                status,
                total,
                succeeded,
                skipped,
                failed,
                pending,
              }) => ({
                id,
                title,
                status,
                total,
                succeeded,
                skipped,
                failed,
                pending,
              }),
            ),
        );
      }
    });
  });

program
  .command("books")
  .description("列出已保存的书籍与章节数量")
  .action(async () => {
    await withStore((store) => {
      console.table(store.listBooks());
    });
  });

for (const name of ["resume", "retry"] as const) {
  const command = program
    .command(name)
    .description(
      name === "resume"
        ? "继续未完成章节，失败章节用 retry 重试"
        : "重试失败章节，并继续未完成部分",
    )
    .argument("<taskId>");
  if (name === "retry") command.option("--failed", "重试失败章节（默认行为）");
  command.action(async (id: string) => {
    const customPath = program.opts<{ config?: string }>().config;
    const customSites = customPath
      ? await loadCustomSites(customPath)
      : undefined;
    await collecting(async (service, store, signal) => {
      const siteName = store.getBook(store.getTask(id).bookId).site;
      const override = customSites?.find((site) => site.name === siteName);
      if (customSites && !override)
        throw new Error(`配置文件中未找到任务所属站点: ${siteName}`);
      printTask(await service.run(id, signal, name === "retry", override));
    });
  });
}

program
  .command("export")
  .description("按目录顺序原子导出书籍，默认拒绝缺章结果")
  .argument("<bookId>")
  .addOption(
    new Option("--format <format>", "导出格式")
      .choices(["txt", "json"])
      .default("txt"),
  )
  .option("--output <path>", "输出文件路径")
  .option("--allow-partial", "允许缺章导出，文件中标明缺章信息")
  .action(
    async (
      id: string,
      options: {
        format: "txt" | "json";
        output?: string;
        allowPartial?: boolean;
      },
    ) => {
      await withStore(async (store) => {
        const result = await exportBook(store, id, {
          ...options,
          outputDir: paths().exports,
        });
        console.log(
          `已导出 ${result.chapters} 章，缺少 ${result.missing} 章: ${result.path}`,
        );
      });
    },
  );

// Preserve the old `node index.js deqixs` / `npm start -- all` entry points.
const args = process.argv.slice(2);
if (["deqixs", "xuanyge", "owlook", "all"].includes(args[0] || "")) {
  const site = args.shift()!;
  args.unshift(
    ...(site === "all" ? ["crawl", "--all"] : ["crawl", "--site", site]),
  );
}
try {
  await program.parseAsync(args, { from: "user" });
} catch (error) {
  console.error(`错误: ${errorMessage(error)}`);
  process.exitCode = 1;
}
