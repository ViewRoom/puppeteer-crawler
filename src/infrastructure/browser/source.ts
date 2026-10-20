import puppeteer, { type Browser, type Page } from "puppeteer";
import { setTimeout } from "node:timers/promises";
import { canonicalUrl, type SiteConfig } from "../../adapters/config.js";
import { CrawlError, throwIfAborted } from "../../domain/errors.js";
import type { ChapterLink } from "../../domain/models.js";
import { retry } from "./retry.js";

export interface Catalog {
  title: string;
  chapters: ChapterLink[];
}

export interface CrawlSource {
  discover(url: string, signal: AbortSignal): Promise<Catalog>;
  readChapter(url: string, signal: AbortSignal): Promise<string>;
  close(): Promise<void>;
}

export type SourceFactory = (
  config: SiteConfig,
  signal: AbortSignal,
) => Promise<CrawlSource>;

export class BrowserSource implements CrawlSource {
  private nextRequestAt = 0;
  private readonly onAbort: () => void;
  private readonly documentUrls = new WeakMap<Page, string>();

  private constructor(
    private readonly browser: Browser,
    private readonly config: SiteConfig,
    private readonly signal: AbortSignal,
  ) {
    this.onAbort = () => {
      void this.browser.close().catch(() => undefined);
    };
    signal.addEventListener("abort", this.onAbort, { once: true });
    if (signal.aborted) this.onAbort();
  }

  static async create(
    config: SiteConfig,
    signal: AbortSignal,
  ): Promise<BrowserSource> {
    throwIfAborted(signal);
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      args: process.env.CRAWLER_NO_SANDBOX === "1" ? ["--no-sandbox"] : [],
    });
    return new BrowserSource(browser, config, signal);
  }

  private async navigate(
    page: Page,
    url: string,
    selector: string,
    signal: AbortSignal,
  ): Promise<void> {
    // Reserve request start times synchronously so concurrent pages share one site rate limit.
    const startAt = Math.max(Date.now(), this.nextRequestAt);
    this.nextRequestAt = startAt + this.config.request.intervalMs;
    await setTimeout(Math.max(0, startAt - Date.now()), undefined, { signal });
    throwIfAborted(signal);
    let status: number;
    if (this.config.transport === "http") {
      // Keep the explicitly requested protocol. Chromium's automatic HTTPS
      // upgrades can make otherwise accessible HTTP-only sites unreachable.
      const response = await fetch(url, {
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(this.config.request.timeoutMs),
        ]),
      });
      status = response.status;
      if (status < 400) {
        const bytes = await response.arrayBuffer();
        const contentType = response.headers.get("content-type") || "";
        const charset =
          contentType.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] || "utf-8";
        const html = new TextDecoder(charset).decode(bytes);
        this.documentUrls.set(page, response.url);
        await page.setContent(html, {
          waitUntil: "domcontentloaded",
          timeout: this.config.request.timeoutMs,
        });
        await page.evaluate((baseUrl) => {
          const base = document.createElement("base");
          base.href = baseUrl;
          document.head.prepend(base);
        }, response.url);
      } else {
        await response.body?.cancel();
      }
    } else {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.config.request.timeoutMs,
      });
      status = response?.status() ?? 200;
    }
    if (status >= 400) {
      throw new CrawlError(
        `HTTP ${status}: ${url}`,
        status >= 500 || status === 429 || status === 408,
      );
    }
    await page.waitForSelector(selector, {
      timeout: this.config.request.timeoutMs,
    });
    throwIfAborted(signal);
  }

  private documentUrl(page: Page): string {
    return this.documentUrls.get(page) || page.url();
  }

  private async newPage(): Promise<Page> {
    const page = await this.browser.newPage();
    try {
      if (this.config.transport === "http") {
        // Static HTML parsing must not run scripts or load embedded resources.
        await page.setJavaScriptEnabled(false);
        await page.setRequestInterception(true);
        page.on("request", (request) => {
          void request.abort().catch(() => undefined);
        });
      }
      return page;
    } catch (error) {
      await page.close().catch(() => undefined);
      throw error;
    }
  }

  private async nextUrl(
    page: Page,
    pagination: SiteConfig["pagination"]["catalog"],
  ): Promise<string | null> {
    if (!pagination) return null;
    const next = await page.$$eval(pagination.selector, (elements) => {
      const element = elements[0];
      return element
        ? {
            url: element.getAttribute("href"),
            text: element.textContent?.trim(),
            disabled:
              element.getAttribute("aria-disabled") === "true" ||
              element.hasAttribute("disabled"),
          }
        : null;
    });
    if (!next || next.disabled || !next.url || next.url.startsWith("#"))
      return null;
    if (pagination.text && next.text !== pagination.text) return null;
    return canonicalUrl(next.url, this.documentUrl(page));
  }

  async discover(url: string, signal: AbortSignal): Promise<Catalog> {
    const page = await this.newPage();
    try {
      const chapters = new Map<string, ChapterLink>();
      const visited = new Set<string>();
      let current: string | null = canonicalUrl(url);
      let title = "";
      const pagination = this.config.pagination.catalog;
      while (current) {
        throwIfAborted(signal);
        if (visited.has(current))
          throw new CrawlError(`目录分页发生循环: ${current}`, false);
        if (visited.size >= (pagination?.maxPages ?? 1))
          throw new CrawlError(
            "目录分页超过 maxPages，未保存不完整目录",
            false,
          );
        visited.add(current);
        const target = current;
        await retry(
          () =>
            this.navigate(
              page,
              target,
              this.config.selectors.chapterList,
              signal,
            ),
          {
            ...this.config.request,
            signal,
          },
        );
        if (visited.size === 1) {
          title = this.config.selectors.novelTitle
            ? await page.$eval(
                this.config.selectors.novelTitle,
                (el) => el.textContent?.trim() || "",
              )
            : new URL(url).searchParams.get("novels_name") ||
              (await page.title());
          if (!title.trim())
            throw new CrawlError(
              "未能提取书名，请检查 novelTitle 选择器",
              false,
            );
        }
        const links = await page.$$eval(
          this.config.selectors.chapterList,
          (elements) =>
            elements.map((element) => ({
              href: element.getAttribute("href"),
              title: element.textContent?.replace(/\s+/g, " ").trim() || "",
            })),
        );
        for (const link of links) {
          if (
            !link.href ||
            !link.title ||
            !/^https?:/i.test(
              new URL(link.href, this.documentUrl(page)).protocol,
            )
          )
            continue;
          const chapterUrl = canonicalUrl(link.href, this.documentUrl(page));
          if (!chapters.has(chapterUrl))
            chapters.set(chapterUrl, {
              url: chapterUrl,
              title: link.title,
              position: chapters.size,
            });
        }
        current = await this.nextUrl(page, pagination);
      }
      if (!chapters.size)
        throw new CrawlError(
          "目录没有有效章节，请检查 chapterList 选择器",
          false,
        );
      return { title, chapters: [...chapters.values()] };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async readChapter(url: string, signal: AbortSignal): Promise<string> {
    const page = await this.newPage();
    try {
      const visited = new Set<string>();
      const contents: string[] = [];
      const pagination = this.config.pagination.content;
      let current: string | null = canonicalUrl(url);
      while (current) {
        throwIfAborted(signal);
        if (visited.has(current))
          throw new CrawlError(`正文分页发生循环: ${current}`, false);
        if (visited.size >= (pagination?.maxPages ?? 1))
          throw new CrawlError("正文分页超过 maxPages", false);
        visited.add(current);
        await this.navigate(
          page,
          current,
          this.config.selectors.chapterContent,
          signal,
        );
        const content = await page.$eval(
          this.config.selectors.chapterContent,
          (element, remove) => {
            for (const selector of remove)
              element
                .querySelectorAll(selector)
                .forEach((child) => child.remove());
            return (element as HTMLElement).innerText;
          },
          this.config.selectors.remove,
        );
        const normalized = content
          .replace(/\r\n?/g, "\n")
          .replace(/\u00a0/g, " ")
          .replace(/[\t ]+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        if (!normalized) throw new CrawlError(`章节正文为空: ${current}`);
        contents.push(normalized);
        current = await this.nextUrl(page, pagination);
      }
      return contents.join("\n\n");
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    this.signal.removeEventListener("abort", this.onAbort);
    await this.browser.close();
  }
}
