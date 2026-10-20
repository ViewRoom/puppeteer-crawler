import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";

export function createLogger(dataDir: string) {
  const logDir = join(dataDir, "logs");
  mkdirSync(logDir, { recursive: true });
  const destination = pino.destination({
    dest: join(logDir, `${new Date().toISOString().slice(0, 10)}.jsonl`),
    sync: true,
  });
  return {
    logger: pino(
      {
        level: process.env.LOG_LEVEL || "info",
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      destination,
    ),
    close: () => destination.end(),
  };
}
