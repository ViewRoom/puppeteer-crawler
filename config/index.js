// 浏览器配置
export const browserConfig = {
  headless: true,
  defaultViewport: null,
  args: ["--start-maximized"],
  // slowMo: 100, // 开发调试时可以打开
};

// 请求配置
export const requestConfig = {
  waitUntil: "networkidle2", // 页面加载完成的判断标准
  timeout: 30000, // 请求超时时间
};

// 并发配置
export const concurrencyConfig = {
  batchSize: 10, // 并发请求数
  maxRetries: 3, // 最大重试次数
  timeout: 30000, // 请求超时时间
};

// 导入站点配置
import owlookConfig from "./sites/owlook.js";
import xuanygeConfig from "./sites/xuanyge.js";
import deqixsConfig from "./sites/deqixs.js";

// 网站爬虫配置
export const crawlerConfig = {
  owlook: owlookConfig,
  xuanyge: xuanygeConfig,
  deqixs: deqixsConfig,
  // 可以在这里添加更多站点配置
};

// 文件保存路径配置
export const pathConfig = {
  data: "./data", // 数据保存路径
  logs: "./log", // 日志保存路径
  novels: "./novels", // 小说保存路径
};
