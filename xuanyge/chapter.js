import {
  appendFileContent,
  saveFile,
  extractChapterInfo,
} from "../utils/tools.js";
import pLimit from "p-limit";

const DATA_PATH = "./data/";

/**
 * 记录错误信息到 error.log
 * @param {String} errorMsg 错误信息
 */
function logError(errorMsg) {
  appendFileContent(DATA_PATH, "error.log", `${errorMsg}\n`);
}

/**
 * 尝试执行异步操作，最多重试 maxRetries 次
 * @param {Function} asyncFunc 异步函数
 * @param {Number} maxRetries 最大重试次数
 * @param {String} url 请求的URL地址
 * @returns {Promise} 异步操作的结果
 */
async function retryAsync(asyncFunc, maxRetries, url) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await asyncFunc();
    } catch (error) {
      if (attempt === maxRetries) {
        logError(`请求<${url}>[${maxRetries}]次: ${error.message}`);
        throw new Error(`Operation failed after retries: ${error.message}`, {
          cause: error,
        });
      }
    }
  }
}

/**
 * 异步爬取小说章节数据
 *
 * @param {Puppeteer.Browser} browser - Puppeteer的浏览器实例
 * @param {string} baseUrl - 爬取的目标小说的基础URL
 * @param {Puppeteer.Page} basePage - Puppeteer的页面实例，用于爬取小说标题和章节列表
 * @returns {Promise<void>}
 * @throws {Error} - 如果输入参数无效，则抛出错误
 */
async function crawlChapterData(browser, baseUrl, basePage) {
  // 验证输入参数
  if (
    !browser ||
    typeof browser !== "object" ||
    !baseUrl ||
    typeof baseUrl !== "string" ||
    !basePage ||
    typeof basePage !== "object"
  ) {
    throw new Error("Invalid input parameters");
  }

  // 定义选择器常量
  const novelTitleSelector = "#bookinfo > div.bookright > div.booktitle > h1";
  const chapterListSelector = "#readerlist > ul > li > a";
  const chapterContentSelector = "#content";

  // 获取小说标题
  await basePage.waitForSelector(novelTitleSelector);
  const novelTitle = await basePage.$eval(novelTitleSelector, (el) =>
    el.innerText.trim()
  );

  // 保存小说信息到文件
  saveFile(DATA_PATH, `${novelTitle}.txt`, "");

  // 等待章节列表加载
  await basePage.waitForSelector(chapterListSelector);

  // 获取章节URLs
  const chapterUrls = await basePage.evaluate((selectors) => {
    return Array.from(document.querySelectorAll(selectors)).map((el) => ({
      url: el.href,
      text: el.textContent.trim(),
    }));
  }, chapterListSelector);

  // 过滤有效的章节URLs
  const validChapterUrls = chapterUrls.filter(({ text }) =>
    extractChapterInfo(text)
  );

  const maxRetries = 3;

  // 并发处理章节
  const batchSize = 10;
  const limit = pLimit(batchSize); // 创建一个限制并发数的函数

  const promises = validChapterUrls.map(({ url, text }) =>
    limit(async () => {
      let chapterContent;
      const chapterPage = await browser.newPage();
      try {
        // 使用重试机制获取章节内容
        chapterContent = await retryAsync(
          async () => {
            await chapterPage.goto(url, {
              waitUntil: "networkidle2",
              timeout: 30000,
            });
            await chapterPage.waitForSelector(chapterContentSelector);
            return await chapterPage.$eval(chapterContentSelector, (el) =>
              el.innerText.replace(/\n\n/g, "\n").replace(/ /g, " ")
            );
          },
          maxRetries,
          url
        );

        // 提取章节信息并格式化内容
        const { chapterName, chapterNum } = extractChapterInfo(text);
        const chapterText = chapterNum
          ? `\n第${chapterNum}章 ${chapterName}\n\n${chapterContent}\n`
          : `\n${chapterName}\n\n${chapterContent}\n`;

        console.log(`第${chapterNum || 0}章 ${chapterName}`);

        return { chapterText, chapterNum, chapterName };
      } catch (error) {
        logError(`获取章节【${chapterName}】失败: ${error.message}`);
        throw error;
      } finally {
        try {
          await chapterPage.close();
        } catch (error) {
          logError(`关闭页面失败: ${error.message}`);
        }
      }
    })
  );

  // 使用 Promise.allSettled 确保所有请求都能完成
  const batchResults = await Promise.allSettled(promises);

  // 收集所有成功的结果
  const successfulResults = batchResults
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value.chapterText)
    .join("");

  // 章节内容到文件
  if (successfulResults) {
    appendFileContent(DATA_PATH, `${novelTitle}.txt`, successfulResults);
  }
}

export { crawlChapterData };
