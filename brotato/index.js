import puppeteer from "puppeteer";
import { crawlCharactersData } from "./characters.js";
import { crawlWeaponsData } from "./weapons.js";
import { crawlStatsData } from "./stats.js";

/**
 * 初始化Brotato数据
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
    // slowMo: 250,
  });

  // 调用函数开始爬取Brotato数据
  await crawlBrotatoData(browser);

  // 关闭浏览器
  await browser.close();
}

/**
 * 爬取Brotato数据
 * @param {*} browser 传入已启动的浏览器对象
 */
async function crawlBrotatoData(browser) {
  // 定义Brotato的基础URL
  const brotatoBaseUrl = "https://brotato.wiki.spellsandguns.com";
  // 在浏览器中打开一个新页面
  const brotatoPage = await browser.newPage();
  // 拼接得到Brotato的主页URL
  const indexUrl = brotatoBaseUrl + "/Brotato_Wiki";

  try {
    // 导航到Brotato主页
    await brotatoPage.goto(indexUrl);
  } catch (error) {
    // 捕获并输出错误信息
    console.error(error);
  }

  // 爬取角色数据
  await crawlCharactersData(browser, brotatoBaseUrl, brotatoPage);
  // 爬取武器数据
  await crawlWeaponsData(browser, brotatoBaseUrl, brotatoPage);
  // 爬取状态数据
  await crawlStatsData(browser, brotatoBaseUrl, brotatoPage);
}

// 执行初始化函数，开始爬取数据流程
init();
