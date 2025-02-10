import pLimit from "p-limit";
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
  const titleSelector = ".all-chapter #maininfo #info h1";
  const authorSelector = ".all-chapter #maininfo #info > p";
  const chapterListSelector = ".all-chapter > .box_con > #list > dl > dd > a";
  const chapterNameSelector = ".all-content > .title > #content_name";
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
    console.log(element);
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
  // 使用单个 evaluate 调用获取所有章节的 URL 和文本
const chapterUrls = await basePage.evaluate((selectors) => {
  return Array.from(document.querySelectorAll(selectors)).map(ele => ({
    href: ele.href,
    text: ele.textContent.trim(),
  }));
}, chapterListSelector);

  // 控制并发度为5
  const limit = pLimit(5);
  let totalChapters = chapterUrls.length;
  let completedChapters = 0;
  // 并发获取章节内容
  const chapterContentsPromises = chapterUrls.map(({href:url, text:chapterName}) =>
    limit(async () => {
      let chapterContent;
      const chapterPage = await browser.newPage();
      try {
        // 访问章节页面
        await chapterPage.goto(url, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });

        // 等待内容选择器加载
        await chapterPage.waitForSelector(chapterContentSelector);

        // 获取内容
        chapterContent = await chapterPage.$eval(
          chapterContentSelector,
          (element) =>
            element.innerText.replace(/\n\n/g, "\n").replace(/ /g, " ")
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
        // 更新完成的章节数并打印进度
        completedChapters++;
        console.log(`进度: ${completedChapters}/${totalChapters}`);
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
