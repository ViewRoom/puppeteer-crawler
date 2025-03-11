export default {
  name: "xuanyge",
  baseUrls: [
    "http://www.xuanyge.org/files/article/html/187/187765/", // 谁让他修仙的
    // 可以添加更多的URL
  ],
  selectors: {
    novelTitle: "#bookinfo > div.bookright > div.booktitle > h1",
    chapterList: ".all-chapter .listmain dl dd a",
    chapterContent: "#chaptercontent",
  },
};
