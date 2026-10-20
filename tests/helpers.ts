import { siteSchema } from "../src/adapters/config.js";
import type { Catalog } from "../src/infrastructure/browser/source.js";
import type { Log } from "../src/domain/models.js";

export const config = siteSchema.parse({
  name: "test",
  selectors: {
    novelTitle: "h1",
    chapterList: ".chapters a",
    chapterContent: "#content",
  },
  request: { retries: 1, retryDelayMs: 0, intervalMs: 0, timeoutMs: 1000 },
  concurrency: 2,
});

export const catalog: Catalog = {
  title: "测试小说",
  chapters: [
    { url: "https://example.test/1", title: "序章", position: 0 },
    { url: "https://example.test/2", title: "第二章", position: 1 },
  ],
};

export const silent: Log = { info() {}, warn() {}, error() {} };
export const signal = () => new AbortController().signal;
