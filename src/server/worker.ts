import { resolve, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { CrawlService } from "../application/crawl.js";
import { builtinSites } from "../adapters/sites.js";
import { errorMessage } from "../domain/errors.js";
import type { Log } from "../domain/models.js";
import type { WorkerState } from "../shared/contracts.js";
import { acquireRunLock } from "../infrastructure/storage/lock.js";
import { Store } from "../infrastructure/storage/store.js";
import { createLogger } from "../infrastructure/logging/logger.js";

const dataDir = resolve(
  process.argv[2] || process.env.CRAWLER_DATA_DIR || "./data",
);
const shutdown = new AbortController();
const stop = () => shutdown.abort(new Error("采集服务停止，已保存进度"));
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.once("disconnect", stop);
const report = (
  status: WorkerState["status"],
  taskId: string | null = null,
  error: string | null = null,
) => {
  if (process.connected)
    process.send?.({ status, taskId, error } satisfies WorkerState);
};

let release: (() => void) | undefined;
let store: Store | undefined;
let logging: ReturnType<typeof createLogger> | undefined;
let scheduleTimer: ReturnType<typeof setInterval> | undefined;
try {
  release = acquireRunLock(join(dataDir, "crawler.sqlite"));
  store = new Store(join(dataDir, "crawler.sqlite"));
  const activeStore = store;
  for (const config of builtinSites) activeStore.saveSite(config, true);
  activeStore.recoverInterrupted();
  logging = createLogger(dataDir);
  const base = logging.logger;
  const logger = Object.fromEntries(
    (["info", "warn", "error"] as const).map((level) => [
      level,
      (fields: object, message: string) => {
        base[level](fields, message);
        const taskId = (fields as { taskId?: string }).taskId;
        activeStore.addEvent(taskId || null, level, message, fields);
      },
    ]),
  ) as unknown as Log;
  const service = new CrawlService(activeStore, logger);
  const tickSchedules = () => {
    if (shutdown.signal.aborted) return;
    for (const schedule of activeStore.schedules()) {
      if (!schedule.enabled || schedule.nextRunAt > Date.now()) continue;
      try {
        activeStore.queueSchedule(schedule.id);
      } catch (error) {
        logger.warn(
          { scheduleId: schedule.id, error: errorMessage(error) },
          "定时采集未能加入队列",
        );
      }
    }
  };
  tickSchedules();
  scheduleTimer = setInterval(tickSchedules, 1000);
  report("ready");
  while (!shutdown.signal.aborted) {
    const job = activeStore.nextJob();
    if (!job) {
      await sleep(500, undefined, { signal: shutdown.signal }).catch(
        () => undefined,
      );
      continue;
    }
    report("busy", job.taskId);
    try {
      await service.run(
        job.taskId,
        shutdown.signal,
        job.mode === "retry",
        undefined,
        true,
      );
    } catch (error) {
      logger.warn(
        { taskId: job.taskId, error: errorMessage(error) },
        "任务未启动",
      );
    }
    report("ready");
  }
} catch (error) {
  report("blocked", null, errorMessage(error));
  process.exitCode = 1;
} finally {
  clearInterval(scheduleTimer);
  logging?.close();
  store?.close();
  release?.();
  if (process.connected) process.disconnect();
}
