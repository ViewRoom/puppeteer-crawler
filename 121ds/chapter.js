import pLimit from "p-limit"; // 引入并发控制库
import {
  appendFileContent,
  extractChapterInfo,
  saveFile,
} from "../utils/tools.js";

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
  const titleAndAuthorSelector =
    ".book-title > h1, .book-stats > b:first-child";
  const chapterListSelector = "#allchapter .details > dl > dd > a";
  const chapterNameSelector = "#BookCon > h1";
  const chapterContentSelector = "#BookCon #BookText";

  // 等待标题和作者选择器加载
  await basePage.waitForSelector(titleAndAuthorSelector);
  // 获取标题和作者信息
  const [titleElement, authorElement] = await basePage.$$eval(
    titleAndAuthorSelector,
    (elements) => {
      return [
        elements[0].innerText,
        elements[1].innerText.split("：")[1].trim(),
      ];
    },
  );

  const title = titleElement;
  const author = authorElement;

  // 保存小说名称和作者
  saveFile(`./data/`, `${title}.txt`, `小说名称：${title}\n作者：${author}\n`);

  // 等待章节列表选择器加载
  await basePage.waitForSelector(chapterListSelector);
  const chapterElements = await basePage.$$(chapterListSelector);

  // 获取章节URL
  const chapterUrlsPromises = chapterElements.map((chapterElement) =>
    basePage.evaluate((ele) => ele.href, chapterElement),
  );
  const chapterUrls = await Promise.all(chapterUrlsPromises);

  // 控制并发度为5
  const limit = pLimit(5);
  // 并发获取章节内容
  const chapterContentsPromises = chapterUrls.map((url) =>
    limit(async () => {
      let chapterName, chapterContent;
      const chapterPage = await browser.newPage();
      try {
        // 访问章节页面
        await chapterPage.goto(url, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });

        // 等待章节名称和内容选择器加载
        await chapterPage.waitForSelector(chapterNameSelector);
        await chapterPage.waitForSelector(chapterContentSelector);

        // 获取章节名称和内容
        chapterName = await chapterPage.$eval(chapterNameSelector, (element) =>
          element.innerText.trim(),
        );
        chapterContent = await chapterPage.$eval(
          chapterContentSelector,
          (element) =>
            element.innerText.replace(/\n\n/g, "\n").replace(/ /g, " "),
        );

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
        console.error(`Error fetching chapter from ${url}:`, error);
        return null;
      } finally {
        // 关闭章节页面
        await chapterPage.close();
      }
    }),
  );

  // 合并章节内容
  const chapterContents = (await Promise.all(chapterContentsPromises))
    .filter(Boolean)
    .join("");
  // 追加章节内容到文件
  appendFileContent(`./data/`, `${title}.txt`, chapterContents);
}

export { crawlChapterData };
