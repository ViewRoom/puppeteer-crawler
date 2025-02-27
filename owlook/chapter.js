import {
  appendFileContent,
  saveFile,
  extractChapterInfo,
  extractNovelsNameFromUrl,
} from "../utils/tools.js";

/**
 * 记录错误信息到 error.log
 * @param {String} errorMsg 错误信息
 */
function logError(errorMsg) {
  appendFileContent("./data/", "error.log", `${errorMsg}\n`);
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
        throw new Error(`Operation failed after retries: ${error.message}`);
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
  if (!browser || !baseUrl || !basePage) {
    throw new Error("Invalid input parameters");
  }

  // 定义选择器常量
  const chapterListSelector = ".all-chapter .listmain dl dd a";
  const chapterContentSelector = "#chaptercontent";

  let titleElement = extractNovelsNameFromUrl(baseUrl);

  // 保存小说信息到文件
  saveFile("./data/", `${titleElement}.txt`, "");

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

  // 初始化章节内容和计数器
  let chapterContents = "";
  let chapterCount = 0;
  let chapterLength = validChapterUrls.length;
  // 最大尝试次数
  let maxRetries = 3;

  // 并发处理章节
  const batchSize = 10;
  for (let i = 0; i < validChapterUrls.length; i += batchSize) {
    const batch = validChapterUrls.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async ({ url, text }) => {
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

          return { chapterText, chapterNum, chapterName };
        } catch (error) {
          logError(`获取章节【${chapterName}】失败: ${error.message}`);
          throw error;
        } finally {
          await chapterPage.close();
        }
      })
    );

    batchResults.forEach(({ chapterText, chapterNum, chapterName }) => {
      chapterContents += chapterText;
      chapterCount++;
      console.log(`第${chapterNum || 0}章 ${chapterName}`);
    });

    console.log(`爬取进度: ${chapterCount}/${chapterLength}`);

    // 每100章保存一次内容到文件
    if (chapterCount % 500 === 0) {
      appendFileContent("./data/", `${titleElement}.txt`, chapterContents);
      chapterContents = "";
    }
  }

  // 保存剩余的章节内容到文件
  if (chapterContents) {
    appendFileContent("./data/", `${titleElement}.txt`, chapterContents);
  }
}

export { crawlChapterData };
