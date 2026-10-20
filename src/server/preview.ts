import { siteSchema, canonicalUrl } from "../adapters/config.js";
import { BrowserSource } from "../infrastructure/browser/source.js";
import { errorMessage } from "../domain/errors.js";
import type { PreviewResult } from "../shared/contracts.js";

const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
process.once("disconnect", () => controller.abort());
process.once("message", async (input: { config: unknown; url: string }) => {
  let source: BrowserSource | undefined;
  try {
    const config = siteSchema.parse(input.config);
    const bounded = {
      ...config,
      request: {
        ...config.request,
        retries: 0,
        timeoutMs: Math.min(config.request.timeoutMs, 10_000),
      },
      pagination: {
        catalog: config.pagination.catalog
          ? {
              ...config.pagination.catalog,
              maxPages: Math.min(config.pagination.catalog.maxPages, 5),
            }
          : undefined,
        content: config.pagination.content
          ? {
              ...config.pagination.content,
              maxPages: Math.min(config.pagination.content.maxPages, 5),
            }
          : undefined,
      },
    };
    source = await BrowserSource.create(bounded, controller.signal);
    const catalog = await source.discover(
      canonicalUrl(input.url),
      controller.signal,
    );
    const first = catalog.chapters[0]!;
    const text = await source.readChapter(first.url, controller.signal);
    const result: PreviewResult = {
      title: catalog.title,
      total: catalog.chapters.length,
      chapters: catalog.chapters
        .slice(0, 5)
        .map(({ title, url }) => ({ title, url })),
      sample: {
        title: first.title,
        text: text.slice(0, 800),
        characters: text.length,
      },
    };
    process.send?.({ result });
  } catch (error) {
    process.send?.({ error: errorMessage(error) });
  } finally {
    await source?.close().catch(() => undefined);
    if (process.connected) process.disconnect();
  }
});
