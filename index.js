import CrawlerFactory from './src/CrawlerFactory.js';
import { mkdir } from './utils/tools.js';
import { pathConfig } from './config/index.js';
import Logger from './utils/logger.js';

const mainLogger = new Logger({ 
  logDir: pathConfig.logs,
  siteName: 'main'
});

/**
 * 初始化目录结构
 */
function initDirectories() {
  Object.values(pathConfig).forEach(dir => {
    try {
      mkdir(dir);
      mainLogger.info(`目录创建成功: ${dir}`);
    } catch (error) {
      mainLogger.error(`创建目录失败 ${dir}: ${error.message}`);
      throw error;
    }
  });
}

/**
 * 主函数
 */
async function main() {
  try {
    mainLogger.info('爬虫程序启动');
    
    // 初始化目录
    initDirectories();
    mainLogger.info('目录初始化完成');
    
    // 获取命令行参数
    const args = process.argv.slice(2);
    const siteName = args[0];
    
    if (siteName && siteName !== 'all') {
      // 爬取特定网站
      mainLogger.info(`开始爬取网站: ${siteName}`);
      const crawler = CrawlerFactory.createCrawler(siteName);
      await crawler.crawl();
      mainLogger.success(`网站 ${siteName} 爬取完成`);
    } else {
      // 爬取所有配置的网站
      mainLogger.info('开始爬取所有配置的网站');
      const crawlers = CrawlerFactory.createAllCrawlers();
      for (const crawler of crawlers) {
        await crawler.crawl();
      }
      mainLogger.success('所有网站爬取完成');
    }
  } catch (error) {
    mainLogger.error(`程序执行出错: ${error.message}`);
    process.exit(1);
  }
}

// 执行主函数
main();