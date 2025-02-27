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
    // slowMo: 100,
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
  const urls = [
    // "https://www.owlook.com.cn/chapter?url=http://www.xbiqugu.net/33/33084/&novels_name=%E8%AF%B8%E5%A4%A9%E5%B0%BD%E5%A4%B4", // 诸天尽头
    // "https://www.owlook.com.cn/chapter?url=https://www.bi02.cc/kan/46287/&novels_name=%E8%B6%85%E7%A5%9E%E6%9C%BA%E6%A2%B0%E5%B8%88", // 超神机械师
    "https://www.owlook.com.cn/chapter?url=https://www.bi05.cc/html/71065/&novels_name=%E9%97%AE%E9%81%93%E7%BA%A2%E5%B0%98", // 问道红尘
  ];
  const baseUrl = urls[0];
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
