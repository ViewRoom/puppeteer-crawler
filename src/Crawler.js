import puppeteer from "puppeteer";
import pLimit from "p-limit";
import { browserConfig, pathConfig, requestConfig } from "../config/index.js";
import {
  saveFile,
  appendFileContent,
  extractChapterInfo,
  extractNovelsNameFromUrl,
} from "../utils/tools.js";
import Logger from "../utils/logger.js";

/**
 * 爬虫类，用于爬取小说网站的数据
 */
class Crawler {
  /**
   * 构造函数
   * @param {Object} config - 爬虫配置对象
   */
  constructor(config) {
    this.config = config;
    this.browser = null;
    this.page = null;
    this.logger = new Logger({
      logDir: pathConfig.logs,
      siteName: config.name,
    });
  }

  /**
   * 初始化浏览器和页面
   */
  async init() {
    this.browser = await puppeteer.launch(browserConfig);
    this.page = await this.browser.newPage();
  }

  /**
   * 开始爬取小说数据
   */
  async crawl() {
    if (!this.browser) {
      await this.init();
    }

    for (const baseUrl of this.config.baseUrls) {
      await this.crawlNovel(baseUrl);
    }

    await this.browser.close();
  }

  /**
   * 爬取单部小说的数据
   * @param {string} baseUrl - 小说的基URL
   */
  async crawlNovel(baseUrl) {
    try {
      this.logger.info(`开始爬取小说: ${baseUrl}`);
      await this.page.goto(baseUrl, { waitUntil: requestConfig.waitUntil });

      const novelTitle = this.config.selectors.novelTitle
        ? await this.page.$eval(this.config.selectors.novelTitle, (el) =>
            el.textContent.trim()
          )
        : extractNovelsNameFromUrl(baseUrl);

      this.logger.info(`获取到小说标题: ${novelTitle}`);
      saveFile(pathConfig.novels, `${novelTitle}.txt`, "");

      let allChapterUrls = [];
      let currentPage = this.page;

      do {
        const chapterUrls = await currentPage.evaluate((selector) => {
          return Array.from(document.querySelectorAll(selector)).map((el) => ({
            url: el.href,
            text: el.textContent.trim(),
          }));
        }, this.config.selectors.chapterList);

        allChapterUrls = allChapterUrls.concat(chapterUrls);

        if (this.config.pagination && this.config.pagination.enabled) {
          const nextPageButton = await currentPage.$(
            this.config.selectors.chapterListNext
          );
          if (!nextPageButton) break;

          await nextPageButton.click();
          await currentPage.waitForNavigation({
            waitUntil: requestConfig.waitUntil,
          });
        } else {
          break;
        }
      } while (true);

      const validChapterUrls = allChapterUrls.filter(({ text }) =>
        extractChapterInfo(text)
      );

      this.logger.info(`获取到 ${validChapterUrls.length} 个有效章节`);
      const limit = pLimit(this.config.concurrency?.batchSize || 10);

      const promises = validChapterUrls.map(({ url, text }) =>
        limit(() => this.crawlChapter(url, text))
      );

      const batchResults = await Promise.allSettled(promises);

      // 收集所有成功的结果
      const successfulResults = batchResults
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value.chapterText)
        .join("\n");

      if (successfulResults) {
        appendFileContent(
          pathConfig.novels,
          `${novelTitle}.txt`,
          successfulResults
        );
      }
    } catch (error) {
      this.logger.error(`爬取小说失败: ${error.message}`);
    }
  }

  /**
   * 爬取单个章节的内容
   * @param {string} url - 章节的URL
   * @param {string} text - 章节的文本
   */
  async crawlChapter(url, text) {
    const chapterPage = await this.browser.newPage();
    const { chapterName, chapterNum } = extractChapterInfo(text);

    try {
      let chapterContent = [];
      let currentUrl = url;

      do {
        await chapterPage.goto(currentUrl, {
          waitUntil: requestConfig.waitUntil,
          timeout: this.config.concurrency?.timeout || 30000,
        });

        const content = await chapterPage.$eval(
          this.config.selectors.chapterContent,
          (el) => el.innerText.replace(/\n\n/g, "\n").replace(/ /g, " ")
        );
        chapterContent.push(content);

        if (this.config.pagination && this.config.pagination.enabled) {
          const nextPageButton = await chapterPage.$(
            this.config.selectors.chapterContentNext
          );
          if (!nextPageButton) break;

          const nextPageButtonText = await chapterPage.$eval(
            this.config.selectors.chapterContentNext,
            (el) => el.innerText.trim()
          );

          if (nextPageButtonText === this.config.pagination.nextPageText) {
            currentUrl = await chapterPage.$eval(
              this.config.selectors.chapterContentNext,
              (el) => el.href
            );
          } else {
            break;
          }
        } else {
          break;
        }
      } while (true);

      const chapterText = chapterNum
        ? `\n第${chapterNum}章 ${chapterName}\n\n${chapterContent.join("\n")}\n`
        : `\n${chapterName}\n\n${chapterContent.join("\n")}\n`;

      this.logger.success(`成功爬取: 第${chapterNum || 0}章 ${chapterName}`);

      return { chapterText };
    } catch (error) {
      this.logger.error(
        `获取章节【第${chapterNum}章 ${chapterName}】失败: ${error.message}`
      );
    } finally {
      try {
        await chapterPage.close();
      } catch (error) {
        this.logger.error(`关闭页面失败: ${error.message}`);
      }
    }
  }
}

export default Crawler;
