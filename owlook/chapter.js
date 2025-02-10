import pLimit from "p-limit";
import {
  appendFileContent,
  saveFile,
  extractChapterInfo,
} from "../utils/tools.js";

/**
 * 记录错误信息到 error.log
 * @param {String} errorMsg 错误信息
 */
function logError(errorMsg) {
  appendFileContent(`./data/`, "error.log", `${errorMsg}\n`);
}

/**
 * 尝试执行异步操作，最多重试 maxRetries 次
 * @param {Function} asyncFunc 异步函数
 * @param {Number} maxRetries 最大重试次数
 * @param {Array} args 异步函数的参数
 * @returns {Promise} 异步操作的结果
 */
async function retryAsync(asyncFunc, maxRetries, ...args) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await asyncFunc(...args);
    } catch (error) {
      if (attempt === maxRetries) {
        logError(`Failed after ${maxRetries} retries: ${error.message}`);
        throw error; // 重新抛出错误，以便上层处理
      }
    }
  }
}

/**
 * 获取章节数据
 * @param {Object} browser 浏览器对象
 * @param {String} baseUrl 网站基础URL
 * @param {Object} basePage 首页对象
 */
async function crawlChapterData(browser, baseUrl, basePage) {
  // 校验输入参数
  if (!browser || !baseUrl || !basePage) {
    throw new Error("Invalid input parameters");
  }

  // 定义选择器常量
  const titleSelector = ".all-chapter #maininfo #info h1";
  const authorSelector = ".all-chapter #maininfo #info > p";
  const chapterListSelector = ".all-chapter > .box_con > #list > dl > dd > a";
  const chapterContentSelector = ".all-content > .show-content > #content";

  // 等待标题和作者选择器加载
  await basePage.waitForSelector(titleSelector);
  await basePage.waitForSelector(authorSelector);

  // 获取标题元素
  const titleElement = await basePage.$eval(
    titleSelector,
    (element) => element.innerText
  );

  // 获取作者元素
  const authorElement = await basePage.$eval(authorSelector, (element) => {
    return element.innerText.split("：")[1].trim();
  });

  // 保存小说名称和作者
  saveFile(
    `./data/`,
    `${titleElement}.txt`,
    `小说名称：${titleElement}\n作者：${authorElement}\n`
  );

  // 等待章节列表选择器加载
  await basePage.waitForSelector(chapterListSelector);

  // 获取章节URL
  const chapterUrls = await basePage.evaluate((selectors) => {
    return Array.from(document.querySelectorAll(selectors)).map((ele) => ({
      href: ele.href,
      text: ele.textContent.trim(),
    }));
  }, chapterListSelector);

  // 控制并发度为5
  const limit = pLimit(5);

  // 并发获取章节内容
  const chapterContentsPromises = chapterUrls.map(
    ({ href: url, text: chapterName }) =>
      limit(async () => {
        let chapterContent;
        const chapterPage = await browser.newPage();
        try {
          // 使用重试函数尝试获取章节内容
          chapterContent = await retryAsync(async () => {
            await chapterPage.goto(url, {
              waitUntil: "networkidle2",
              timeout: 30000,
            });
            await chapterPage.waitForSelector(chapterContentSelector);
            return await chapterPage.$eval(chapterContentSelector, (element) =>
              element.innerText.replace(/\n\n/g, "\n").replace(/ /g, " ")
            );
          }, 3); // 最大重试3次

          // 处理章节信息
          if (extractChapterInfo(chapterName)) {
            const { chapterName: name, chapterNum } =
              extractChapterInfo(chapterName);
            let chapterText = "";
            if (chapterNum) {
              chapterText = `\n第${chapterNum}章 ${name}\n\n${chapterContent}\n`;
            } else {
              chapterText = `\n${name}\n\n${chapterContent}\n`;
            }

            console.log(`第${chapterNum || 0}章 ${name}`);
            
            return chapterText;
          }
        } catch (error) {
          // 如果重试后仍然失败，则抛出错误（由上层调用者处理）
          throw error;
        } finally {
          await chapterPage.close();
        }
      })
  );

  // 合并章节内容
  const chapterContents = (await Promise.all(chapterContentsPromises))
    .filter(Boolean)
    .join("");

  // 追加章节内容到文件
  appendFileContent(`./data/`, `${titleElement}.txt`, chapterContents);
}

export { crawlChapterData };
