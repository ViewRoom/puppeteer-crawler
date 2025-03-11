export default {
  name: "deqixs",
  baseUrls: [
    "https://www.deqixs.com/xiaoshuo/250/", // 谁让他修仙的
  ],
  selectors: {
    novelTitle: "h1 > a",
    chapterList: "#list > ul > li > a",
    chapterListNext: "#pages > a.gr",
    chapterContent: ".container > .con",
    chapterContentNext: "div.prenext > span:nth-child(3) > a",
  },
  pagination: {
    enabled: true,
    nextPageText: "下一页",
  },
  concurrency: {
    batchSize: 2,
    maxRetries: 4,
    timeout: 10000,
  },
};
