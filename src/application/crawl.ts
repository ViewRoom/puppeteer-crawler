import {
  canonicalUrl,
  siteSchema,
  type SiteConfig,
} from "../adapters/config.js";
import { errorMessage, throwIfAborted } from "../domain/errors.js";
import type { CrawlProgress, Log, TaskSummary } from "../domain/models.js";
import {
  BrowserSource,
  type CrawlSource,
  type SourceFactory,
} from "../infrastructure/browser/source.js";
import { retry } from "../infrastructure/browser/retry.js";
import { Store } from "../infrastructure/storage/store.js";

export class CrawlService {
  constructor(
    private readonly store: Store,
    private readonly logger: Log,
    private readonly sourceFactory: SourceFactory = BrowserSource.create,
    private readonly onProgress?: (progress: CrawlProgress) => void,
  ) {}

  async start(
    config: SiteConfig,
    url: string,
    signal: AbortSignal,
    refresh = false,
  ): Promise<TaskSummary> {
    throwIfAborted(signal);
    const task = this.store.createTask(config, canonicalUrl(url), refresh);
    return this.run(task.id, signal);
  }

  async run(
    taskId: string,
    signal: AbortSignal,
    retryFailed = false,
    overrideConfig?: SiteConfig,
    fromQueue = false,
  ): Promise<TaskSummary> {
    const task = this.store.getTask(taskId);
    if (task.status === "running") throw new Error(`任务正在运行: ${taskId}`);
    if (task.status === "completed") return this.store.summary(taskId);
    throwIfAborted(signal);
    const config = siteSchema.parse(
      overrideConfig || JSON.parse(task.siteConfig),
    );
    if (config.name !== this.store.getBook(task.bookId).site)
      throw new Error("恢复配置的站点名称必须与任务一致");
    this.store.beginRun(taskId, retryFailed, fromQueue, overrideConfig);
    const controls = new AbortController();
    signal = AbortSignal.any([signal, controls.signal]);
    const controlTimer = setInterval(() => {
      const action = this.store.control(taskId);
      if (action)
        controls.abort(
          new Error(action === "pause" ? "任务已暂停" : "任务已取消"),
        );
    }, 200);
    let source: CrawlSource | undefined;
    try {
      this.logger.info({ taskId, site: config.name }, "开始采集任务");
      this.onProgress?.({
        taskId,
        phase: "starting",
        total: 0,
        done: 0,
        skipped: 0,
        failed: 0,
      });
      source = await this.sourceFactory(config, signal);
      if (!task.catalogComplete) {
        const book = this.store.getBook(task.bookId);
        const catalog = await source.discover(book.url, signal);
        throwIfAborted(signal);
        this.store.saveCatalog(
          taskId,
          catalog.title,
          catalog.chapters,
          Boolean(task.refresh),
        );
        this.logger.info(
          { taskId, chapters: catalog.chapters.length },
          "目录已保存",
        );
      }
      const pending = this.store
        .items(taskId)
        .filter((item) => item.status === "pending");
      const initial = this.store.summary(taskId);
      const progress: CrawlProgress = {
        taskId,
        phase: "catalog",
        total: initial.total,
        done: initial.succeeded + initial.skipped + initial.failed,
        skipped: initial.skipped,
        failed: initial.failed,
      };
      this.onProgress?.({ ...progress });
      let cursor = 0;
      const activeSource = source;
      const worker = async () => {
        while (!signal.aborted) {
          const item = pending[cursor++];
          if (!item) return;
          try {
            const content = await retry(
              () => activeSource.readChapter(item.url, signal),
              {
                ...config.request,
                signal,
                onAttempt: () => this.store.attempt(taskId, item.chapterId),
                onRetry: (error, attempt) =>
                  this.logger.warn(
                    {
                      taskId,
                      url: item.url,
                      attempt,
                      error: errorMessage(error),
                    },
                    "章节失败，准备重试",
                  ),
              },
            );
            throwIfAborted(signal);
            this.store.succeed(taskId, item.chapterId, content);
            progress.done++;
            this.onProgress?.({ ...progress, phase: "chapter" });
            this.logger.info(
              { taskId, chapterId: item.chapterId, title: item.title },
              "章节已保存",
            );
          } catch (error) {
            if (signal.aborted) return;
            this.store.fail(taskId, item.chapterId, errorMessage(error));
            progress.done++;
            progress.failed++;
            this.onProgress?.({ ...progress, phase: "chapter" });
            this.logger.error(
              { taskId, url: item.url, error: errorMessage(error) },
              "章节采集失败",
            );
          }
        }
      };
      // Only concurrency workers are created, rather than one promise per chapter.
      const results = await Promise.allSettled(
        Array.from(
          { length: Math.min(config.concurrency, pending.length) },
          worker,
        ),
      );
      const unexpected = results.find((result) => result.status === "rejected");
      if (unexpected?.status === "rejected") throw unexpected.reason;
      throwIfAborted(signal);
      const summary = this.store.summary(taskId);
      this.store.status(
        taskId,
        summary.failed ? "failed" : "completed",
        summary.failed ? `${summary.failed} 个章节失败，可补采失败章节` : null,
      );
    } catch (error) {
      this.store.status(
        taskId,
        signal.aborted ? "interrupted" : "failed",
        errorMessage(error),
      );
      this.logger.error(
        { taskId, error: errorMessage(error), interrupted: signal.aborted },
        "任务未完成，已保存进度",
      );
    } finally {
      clearInterval(controlTimer);
      this.store.resetRunning(taskId);
      if (source) {
        try {
          await source.close();
        } catch (error) {
          this.logger.warn(
            { taskId, error: errorMessage(error) },
            "关闭浏览器时发生错误",
          );
        }
      }
      this.store.finishControl(taskId);
    }
    const summary = this.store.summary(taskId);
    this.logger.info(
      {
        taskId,
        status: summary.status,
        succeeded: summary.succeeded,
        skipped: summary.skipped,
        failed: summary.failed,
      },
      "任务结束",
    );
    return summary;
  }
}
