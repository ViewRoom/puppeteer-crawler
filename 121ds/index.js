import puppeteer from "puppeteer";
import { crawlChapterData } from "./chapter.js";

/**
 * 初始化数据
 */
async function init() {
  // 启动puppeteer浏览器
  const browser = await puppeteer.launch({
    // 非无头模式，即显示浏览器界面
    headless: true,
    // 视口大小
    defaultViewport: null,
    // 启动时最大化浏览器窗口
    args: ["--start-maximized"],
    // 操作速度
    slowMo: 100,
  });

  // 调用函数开始爬取数据
  await crawlData(browser);

  // 关闭浏览器
  await browser.close();
}

/**
 * 爬取数据
 * @param {*} browser 传入已启动的浏览器对象
 */
async function crawlData(browser) {
  // 定义基础URL
  const  urls = [
      "https://www.121ds.cc/9950", // 九星毒奶
      "https://www.121ds.cc/2909/" // 诸天尽头
  ]
  const baseUrl = urls[1];
  // 在浏览器中打开一个新页面
  const page = await browser.newPage();
  // 主页URL
  const indexUrl = baseUrl;

  try {
    // 导航到主页
    await page.goto(indexUrl);
  } catch (error) {
    // 捕获并输出错误信息
    console.error(error);
  }

  // 爬取章节列表
  await crawlChapterData(browser, baseUrl, page);
}

// 执行初始化函数，开始爬取数据流程
init();
