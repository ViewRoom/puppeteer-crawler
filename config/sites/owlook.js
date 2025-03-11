export default {
  name: "owlook",
  baseUrls: [
    "https://www.owlook.com.cn/chapter?url=https://www.bi05.cc/html/71065/&novels_name=%E9%97%AE%E9%81%93%E7%BA%A2%E5%B0%98", // 问道红尘
    // 可以添加更多的URL
  ],
  selectors: {
    chapterList: ".all-chapter .listmain dl dd a",
    chapterContent: "#chaptercontent",
  },
};
