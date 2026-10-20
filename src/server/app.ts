import Fastify from "fastify";
import staticFiles from "@fastify/static";
import { z } from "zod";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { siteSchema, canonicalUrl } from "../adapters/config.js";
import { builtinSites } from "../adapters/sites.js";
import {
  ConflictError,
  NotFoundError,
  errorMessage,
} from "../domain/errors.js";
import { exportBook, safeFilename } from "../exporters/book.js";
import { Store } from "../infrastructure/storage/store.js";
import { WorkerSupervisor, previewInProcess } from "./processes.js";
import type { Dashboard, WorkerState } from "../shared/contracts.js";

const idParams = z.object({ id: z.string().uuid() });
const httpUrl = z
  .string()
  .url()
  .refine((url) => /^https?:\/\//i.test(url), "只支持 HTTP(S) 地址")
  .transform((url) => canonicalUrl(url));
const taskBody = z
  .object({
    site: z.string().min(1),
    url: httpUrl,
    refresh: z.boolean().default(false),
  })
  .strict();
const pagination = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().max(200).default(""),
  status: z
    .enum(["", "pending", "running", "succeeded", "failed", "skipped"])
    .default(""),
  level: z.enum(["", "info", "warn", "error"]).default(""),
});

export async function createApp(options: {
  dataDir: string;
  startWorker?: boolean;
  serveWeb?: boolean;
}) {
  const dataDir = resolve(options.dataDir);
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  const store = new Store(join(dataDir, "crawler.sqlite"));
  for (const site of builtinSites) store.saveSite(site, true);
  store.recoverExports();
  const supervisor = new WorkerSupervisor(dataDir);
  let previewBusy = false;

  app.addHook("onRequest", async (request, reply) => {
    // Local administration only. Guard Host as well as Origin against browser
    // requests from unrelated pages, including DNS rebinding to localhost.
    const host = request.headers.host || "";
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) {
      return reply.code(403).send({ error: "管理台仅支持本机访问" });
    }
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const origin = request.headers.origin;
      if (
        origin &&
        origin !== `http://${host}` &&
        !["http://localhost:5173", "http://127.0.0.1:5173"].includes(origin)
      ) {
        return reply.code(403).send({ error: "不允许来自其他站点的操作" });
      }
      if (
        request.method !== "DELETE" &&
        !request.headers["content-type"]?.startsWith("application/json")
      ) {
        return reply.code(415).send({ error: "请使用 JSON 请求" });
      }
    }
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Cache-Control", "no-store");
  });
  app.setErrorHandler((error, _request, reply) => {
    let code = 500;
    let message = "服务处理失败";
    if (error instanceof z.ZodError) {
      code = 400;
      message = error.issues
        .map((issue) => `${issue.path.join(".") || "请求"}: ${issue.message}`)
        .join("；");
    } else if (error instanceof NotFoundError) {
      code = 404;
      message = error.message;
    } else if (error instanceof ConflictError) {
      code = 409;
      message = error.message;
    } else if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode < 500
    ) {
      code = error.statusCode;
      message = errorMessage(error);
    } else {
      console.error(error);
    }
    reply.code(code).send({ error: message });
  });

  app.get("/api/health", async () => ({ ok: true, worker: supervisor.state }));
  app.get("/api/state", async (): Promise<Dashboard> => ({
    books: store.listBooks(),
    tasks: store.listTasks(100),
    sites: store.sites(),
    schedules: store.schedules(),
    exports: store.exports(),
    stats: store.stats(),
    worker: supervisor.state,
  }));
  app.post("/api/tasks", async (request, reply) => {
    const body = taskBody.parse(request.body);
    const task = store.createQueuedTask(
      store.getSite(body.site).config,
      body.url,
      body.refresh,
    );
    return reply.code(201).send(store.summary(task.id));
  });
  app.get("/api/tasks/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const query = pagination.parse(request.query);
    return {
      task: store.summary(id),
      items: store.itemPage(id, query.offset, query.limit, query.status),
      events: store.events(id, query.level),
    };
  });
  app.post("/api/tasks/:id/:action", async (request) => {
    const { id, action } = idParams
      .extend({ action: z.enum(["pause", "cancel", "resume", "retry"]) })
      .parse(request.params);
    if (action === "pause" || action === "cancel")
      store.requestControl(id, action);
    else {
      const task = store.getTask(id);
      const site = store.getSite(store.getBook(task.bookId).site);
      store.enqueue(id, action, site.config);
    }
    return store.summary(id);
  });
  app.get("/api/books/:id/chapters", async (request) => {
    const { id } = idParams.parse(request.params);
    const query = pagination.parse(request.query);
    return store.chapterPage(id, query.offset, query.limit, query.search);
  });
  app.get("/api/books/:id/chapters/:chapterId", async (request) => {
    const { id, chapterId } = idParams
      .extend({ chapterId: z.string().uuid() })
      .parse(request.params);
    return store.chapter(id, chapterId);
  });
  app.put("/api/sites/:name", async (request) => {
    const { name } = z.object({ name: z.string() }).parse(request.params);
    const config = siteSchema.parse(request.body);
    if (name !== config.name)
      throw new ConflictError("路径名称与配置中的 name 不一致");
    return store.saveSite(config);
  });
  app.post("/api/sites/preview", async (request, reply) => {
    const { config, url } = z
      .object({ config: siteSchema, url: httpUrl })
      .strict()
      .parse(request.body);
    if (previewBusy)
      throw new ConflictError("已有站点测试正在进行，请稍后重试");
    previewBusy = true;
    try {
      return await previewInProcess(config, url);
    } catch (error) {
      return reply.code(422).send({ error: errorMessage(error) });
    } finally {
      previewBusy = false;
    }
  });
  app.post("/api/schedules", async (request, reply) => {
    const body = taskBody
      .omit({ refresh: true })
      .extend({ intervalMinutes: z.number().int().min(5).max(43_200) })
      .parse(request.body);
    return reply
      .code(201)
      .send(store.createSchedule(body.site, body.url, body.intervalMinutes));
  });
  app.patch("/api/schedules/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(request.body);
    return store.setScheduleEnabled(id, enabled);
  });
  app.post("/api/schedules/:id/run", async (request) => {
    const { id } = idParams.parse(request.params);
    const task = store.queueSchedule(id, Date.now(), true)!;
    return store.summary(task.id);
  });
  app.delete("/api/schedules/:id", async (request) => {
    store.deleteSchedule(idParams.parse(request.params).id);
    return { ok: true };
  });
  app.post("/api/exports", async (request, reply) => {
    const body = z
      .object({
        bookId: z.string().uuid(),
        format: z.enum(["txt", "json"]).default("txt"),
        allowPartial: z.boolean().default(false),
      })
      .strict()
      .parse(request.body);
    const book = store.getBook(body.bookId);
    const record = store.createExport(
      book.id,
      body.format,
      `${safeFilename(book.title)}.${body.format}`,
    );
    try {
      const result = await exportBook(store, book.id, {
        format: body.format,
        allowPartial: body.allowPartial,
        outputDir: join(dataDir, "exports"),
        output: join(dataDir, "exports", `${record.id}.${body.format}`),
      });
      return reply
        .code(201)
        .send(store.finishExport(record.id, result.missing));
    } catch (error) {
      store.finishExport(record.id, 0, errorMessage(error));
      throw new ConflictError(errorMessage(error));
    }
  });
  app.get("/api/exports/:id/download", async (request, reply) => {
    const record = store.getExport(idParams.parse(request.params).id);
    if (record.status !== "completed")
      throw new ConflictError("导出文件尚未生成成功");
    const path = join(dataDir, "exports", `${record.id}.${record.format}`);
    try {
      await stat(path);
    } catch {
      throw new NotFoundError("导出文件已不存在，请重新生成");
    }
    reply.type(
      record.format === "json"
        ? "application/json; charset=utf-8"
        : "text/plain; charset=utf-8",
    );
    reply.header(
      "Content-Disposition",
      `attachment; filename="book.${record.format}"; filename*=UTF-8''${encodeURIComponent(record.filename)}`,
    );
    return reply.send(createReadStream(path));
  });

  if (options.serveWeb !== false) {
    const webRoot = fileURLToPath(
      new URL(
        import.meta.url.endsWith(".ts") ? "../../dist/web/" : "../web/",
        import.meta.url,
      ),
    );
    if (existsSync(join(webRoot, "index.html"))) {
      await app.register(staticFiles, { root: webRoot });
      app.setNotFoundHandler((request, reply) => {
        if (
          request.method === "GET" &&
          !request.url.startsWith("/api/") &&
          !request.url.startsWith("/assets/")
        )
          return reply.sendFile("index.html");
        return reply.code(404).send({ error: "接口不存在" });
      });
    }
  }
  app.addHook("onReady", async () => {
    if (options.startWorker !== false) supervisor.start();
  });
  app.addHook("onClose", async () => {
    await supervisor.stop();
    store.close();
  });
  return {
    app,
    store,
    supervisor,
    workerState: (): WorkerState => supervisor.state,
  };
}
