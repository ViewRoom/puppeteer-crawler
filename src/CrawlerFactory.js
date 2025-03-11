import Crawler from './Crawler.js';
import { crawlerConfig } from '../config/index.js';

class CrawlerFactory {
  /**
   * 创建特定网站的爬虫实例
   * @param {string} siteName - 网站名称
   * @returns {Crawler} - 爬虫实例
   */
  static createCrawler(siteName) {
    const config = crawlerConfig[siteName];
    if (!config) {
      throw new Error(`不支持的网站: ${siteName}`);
    }
    return new Crawler(config);
  }

  /**
   * 创建所有配置的网站爬虫实例
   * @returns {Crawler[]} - 爬虫实例数组
   */
  static createAllCrawlers() {
    return Object.keys(crawlerConfig).map(siteName => 
      this.createCrawler(siteName)
    );
  }
}

export default CrawlerFactory;