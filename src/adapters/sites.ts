import { siteSchema } from "./config.js";

export const builtinSites = [
  {
    name: "bingfengxs",
    transport: "http",
    baseUrls: ["http://www.bingfengxs.com/198/198226/"],
    selectors: {
      novelTitle: ".ml_title h1",
      chapterList: ".ml_main dd a",
      chapterContent: ".yd_text2",
      remove: ["#center_tip", "script", "style", "ins"],
    },
    request: {
      timeoutMs: 30000,
      retries: 3,
      retryDelayMs: 1000,
      intervalMs: 1000,
    },
    concurrency: 2,
  },
  {
    name: "deqixs",
    baseUrls: ["https://www.deqixs.com/xiaoshuo/250/"],
    selectors: {
      novelTitle: "h1 > a",
      chapterList: "#list > ul > li > a",
      chapterContent: ".container > .con",
    },
    pagination: {
      catalog: { selector: "#pages > a.gr", maxPages: 1000 },
      content: {
        selector: "div.prenext > span:nth-child(3) > a",
        text: "下一页",
        maxPages: 100,
      },
    },
    request: { timeoutMs: 10_000, retries: 4 },
    concurrency: 2,
  },
  {
    name: "xuanyge",
    baseUrls: ["http://www.xuanyge.org/files/article/html/187/187765/"],
    selectors: {
      novelTitle: "#bookinfo > div.bookright > div.booktitle > h1",
      chapterList: ".all-chapter .listmain dl dd a",
      chapterContent: "#chaptercontent",
    },
  },
  {
    name: "owlook",
    baseUrls: [
      "https://www.owlook.com.cn/chapter?url=https://www.bi05.cc/html/71065/&novels_name=%E9%97%AE%E9%81%93%E7%BA%A2%E5%B0%98",
    ],
    selectors: {
      chapterList: ".all-chapter .listmain dl dd a",
      chapterContent: "#chaptercontent",
    },
  },
].map((site) => siteSchema.parse(site));
