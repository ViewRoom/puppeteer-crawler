import puppeteer from "puppeteer";
import pLimit from "p-limit";
import {
  browserConfig,
  pathConfig,
  requestConfig,
  concurrencyConfig,
} from "../config/index.js";
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
   * 异步爬取小说方法
   * @param {string} baseUrl 小说的基URL
   */
  async crawlNovel(baseUrl) {
    try {
      // 记录开始爬取小说的日志
      this.logger.info(`开始爬取小说: ${baseUrl}`);
      // 导航到小说的基URL
      await this.page.goto(baseUrl, { waitUntil: requestConfig.waitUntil });

      // 获取小说标题
      const novelTitle = this.config.selectors.novelTitle
        ? await this.page.$eval(this.config.selectors.novelTitle, (el) =>
            el.textContent.trim()
          )
        : extractNovelsNameFromUrl(baseUrl);

      // 记录获取到的小说标题
      this.logger.info(`获取到小说标题: ${novelTitle}`);
      // 创建或覆盖小说文件
      saveFile(pathConfig.novels, `${novelTitle}.txt`, "");

      // 初始化章节URL列表和当前页面变量
      let allChapterUrls = [];
      let currentPage = this.page;

      // 循环获取所有章节URL
      do {
        const chapterUrls = await currentPage.evaluate((selector) => {
          return Array.from(document.querySelectorAll(selector)).map((el) => ({
            url: el.href,
            text: el.textContent.trim(),
          }));
        }, this.config.selectors.chapterList);

        // 将当前页面的章节URL添加到总列表中
        allChapterUrls = allChapterUrls.concat(chapterUrls);

        // 如果启用了分页功能，查找并点击下一页按钮
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

      // 过滤出有效的章节URL
      const validChapterUrls = allChapterUrls.filter(({ text }) =>
        extractChapterInfo(text)
      );

      // 记录获取到的有效章节数量
      this.logger.info(`获取到 ${validChapterUrls.length} 个有效章节`);
      // 创建一个并发控制对象
      const limit = pLimit(
        this.config.concurrency?.batchSize || concurrencyConfig.batchSize
      );

      // 为每个有效章节URL创建一个爬取章节内容的Promise
      const promises = validChapterUrls.map(({ url, text }) =>
        limit(() => this.crawlChapter(url, text))
      );

      // 并发执行所有章节内容的爬取
      const batchResults = await Promise.allSettled(promises);

      // 收集所有成功的结果
      const successfulResults = batchResults
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value.chapterText)
        .join("\n");

      // 如果有成功的结果，将其追加到小说文件中
      if (successfulResults) {
        appendFileContent(
          pathConfig.novels,
          `${novelTitle}.txt`,
          successfulResults
        );
      }
    } catch (error) {
      // 记录爬取小说失败的日志
      this.logger.error(`爬取小说失败: ${error.message}`);
    }
  }

  /**
   * 爬取单个章节的内容
   * @param {string} url - 章节的URL
   * @param {string} text - 章节的文本
   */
  async crawlChapter(url, text) {
    // 创建新的页面实例用于爬取章节内容
    const chapterPage = await this.browser.newPage();

    // 从给定的文本中提取章节名称和编号
    const { chapterName, chapterNum } = extractChapterInfo(text);

    try {
      let chapterContent = [];
      let currentUrl = url;

      // 开始爬取章节内容的循环
      do {
        // 导航到当前URL，并等待页面加载完成
        await chapterPage.goto(currentUrl, {
          waitUntil: requestConfig.waitUntil,
          timeout:
            this.config.concurrency?.timeout || concurrencyConfig.timeout,
        });

        // 提取当前页面的章节内容，并进行文本处理后添加到章节内容数组中
        const content = await chapterPage.$eval(
          this.config.selectors.chapterContent,
          (el) => el.innerText.replace(/\n\n/g, "\n").replace(/ /g, " ")
        );
        chapterContent.push(content);

        // 如果配置了分页，尝试寻找并点击下一页按钮，否则退出循环
        if (this.config.pagination && this.config.pagination.enabled) {
          const nextPageButton = await chapterPage.$(
            this.config.selectors.chapterContentNext
          );
          if (!nextPageButton) break;

          const nextPageButtonText = await chapterPage.$eval(
            this.config.selectors.chapterContentNext,
            (el) => el.innerText.trim()
          );

          // 根据下一页按钮的文本判断是否需要继续爬取下一页
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

      // 根据章节编号和名称以及内容生成章节文本
      const chapterText = chapterNum
        ? `\n第${chapterNum}章 ${chapterName}\n\n${chapterContent.join("\n")}\n`
        : `\n${chapterName}\n\n${chapterContent.join("\n")}\n`;

      // 日志记录章节爬取成功
      this.logger.success(`成功爬取: 第${chapterNum || 0}章 ${chapterName}`);

      // 返回章节文本
      return { chapterText };
    } catch (error) {
      // 如果发生错误，记录错误信息
      this.logger.error(
        `获取章节【第${chapterNum}章 ${chapterName}】失败: ${error.message}`
      );
    } finally {
      // 无论成功还是失败，确保关闭章节页面
      try {
        await chapterPage.close();
      } catch (error) {
        this.logger.error(`关闭页面失败: ${error.message}`);
      }
    }
  }
}

export default Crawler;
