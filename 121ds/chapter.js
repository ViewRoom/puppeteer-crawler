import {
  saveFile,
  appendFileContent,
} from "../utils/tools.js";

/**
 * 获取章节数据
 * @param {Object} browser 浏览器对象
 * @param {String} baseUrl 网站基础URL
 * @param {Object} basePage 首页对象
 */
async function crawlChapterData(browser, baseUrl, basePage) {
  // 获取小说名称和作家
  const titleAndAuthorSelector = ".book-title > h1, .book-stats > b:first-child";

  await basePage.waitForSelector(titleAndAuthorSelector);
  const [titleElement, authorElement] = await basePage.$$eval(
    titleAndAuthorSelector,
    (elements) => {
      return [
        elements[0].innerText,
        elements[1].innerText.split("：")[1].trim(),
      ];
    }
  );

  const title = titleElement;
  const author = authorElement;

  // 保存小说名称和作者
  saveFile(`./data/`, `${title}.txt`, `小说名称：${title}\n作者：${author}\n`);

  // 获取章节列表
  const chapterListSelector = "#allchapter .details > dl > dd > a";
  await basePage.waitForSelector(chapterListSelector);
  const chapterElements = await basePage.$$(chapterListSelector);

  const chapterUrlsPromises = chapterElements.map((chapterElement) =>
    basePage.evaluate((ele) => ele.href, chapterElement)
  );
  const chapterUrls = await Promise.all(chapterUrlsPromises);

  for (const url of chapterUrls) {
    let chapterName, chapterContent;

    const chapterPage = await browser.newPage();
    try {
      await chapterPage.goto(url);

      const chapterNameSelector = "#BookCon > h1";
      const chapterContentSelector = "#BookCon #BookText ";
      await chapterPage.waitForSelector(chapterNameSelector);
      await chapterPage.waitForSelector(chapterContentSelector);

      chapterName = await chapterPage.$eval(chapterNameSelector, (element) =>
        element.innerText.trim()
      );
      chapterContent = await chapterPage.$eval(
        chapterContentSelector,
        (element) => element.innerText.replace(/\n\n/g, "\n").replace(/ /g, " "))
    } catch (error) {
      console.error(`Error fetching chapter from ${url}:`, error);
      continue; // 跳过当前章节并继续下一个
    }

    const chapterText = `\n${chapterName}\n\n${chapterContent}\n`;
    console.log(chapterName);

    // 考虑使用追加模式写入文件，或者先收集所有数据，然后一次性写入
    appendFileContent(`./data/`, `${title}.txt`, chapterText);

    await chapterPage.close(); // 关闭当前章节页面
  }
}

export {crawlChapterData};
