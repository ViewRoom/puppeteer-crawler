import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { SiteConfig } from "../adapters/config.js";
import type { PreviewResult, WorkerState } from "../shared/contracts.js";

function entry(name: string): string {
  return fileURLToPath(
    new URL(
      `./${name}.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`,
      import.meta.url,
    ),
  );
}

export class WorkerSupervisor {
  state: WorkerState = { status: "stopped", taskId: null, error: null };
  private child?: ChildProcess;
  private restart?: ReturnType<typeof setTimeout>;
  private stopping = false;

  constructor(private readonly dataDir: string) {}

  start(): void {
    if (this.stopping || this.child) return;
    this.state = { status: "starting", taskId: null, error: null };
    const child = fork(entry("worker"), [this.dataDir], {
      execArgv: import.meta.url.endsWith(".ts") ? ["--import", "tsx"] : [],
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    this.child = child;
    let diagnostics = "";
    child.stderr?.on("data", (chunk) => {
      diagnostics = (diagnostics + String(chunk)).slice(-2000);
    });
    child.on("message", (message: WorkerState) => {
      if (message && ["ready", "busy", "blocked"].includes(message.status))
        this.state = message;
    });
    child.on("error", (error) => {
      this.state = { status: "blocked", taskId: null, error: error.message };
    });
    child.on("exit", () => {
      this.child = undefined;
      if (this.stopping) {
        this.state = { status: "stopped", taskId: null, error: null };
        return;
      }
      this.state = {
        status: "blocked",
        taskId: null,
        error:
          this.state.error ||
          diagnostics.trim() ||
          "采集进程已退出，正在重新连接",
      };
      this.restart = setTimeout(() => this.start(), 5000);
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.restart);
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => child.kill("SIGKILL"), 5000);
      child.once("exit", () => {
        clearTimeout(force);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }
}

export function previewInProcess(
  config: SiteConfig,
  url: string,
): Promise<PreviewResult> {
  return new Promise((resolve, reject) => {
    const child = fork(entry("preview"), [], {
      execArgv: import.meta.url.endsWith(".ts") ? ["--import", "tsx"] : [],
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    let settled = false;
    const finish = (error?: Error, result?: PreviewResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(result!);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("站点测试超过 30 秒，请检查地址或选择器"));
    }, 30_000);
    child.once(
      "message",
      (message: { result?: PreviewResult; error?: string }) => {
        if (message.result) finish(undefined, message.result);
        else finish(new Error(message.error || "站点测试失败"));
      },
    );
    child.once("error", (error) => finish(error));
    child.once("exit", () => finish(new Error("站点测试进程提前退出")));
    child.send({ config, url });
  });
}
