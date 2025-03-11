import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdir } from './tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class Logger {
  /**
   * 构造函数
   *
   * @param options 配置选项
   * @param options.logDir 日志文件存储目录，默认为 './logs'
   * @param options.siteName 网站名称，默认为 'default'
   * @param options.dateFormat 日期格式，默认为 'YYYY-MM-DD HH:mm:ss'
   */
  constructor(options = {}) {
    this.logDir = options.logDir || "./logs";
    this.siteName = options.siteName || "default";
    this.dateFormat = options.dateFormat || "YYYY-MM-DD HH:mm:ss";
    this.init();
  }

  /**
   * 初始化日志目录
   *
   * @throws {Error} 如果创建目录或验证权限失败，则抛出异常
   */
  init() {
    try {
      mkdir(this.logDir);
      // 创建一个测试日志文件以验证权限
      const testPath = path.join(this.logDir, ".test");
      fs.writeFileSync(testPath, "", "utf8");
      fs.unlinkSync(testPath);
    } catch (error) {
      console.error(`初始化日志目录失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 获取当前时间的 ISO 8601 格式字符串
   *
   * @returns {string} 返回当前时间的 ISO 8601 格式字符串
   */
  getTimestamp() {
    return new Date().toISOString();
  }

  /**
   * 获取日志文件路径
   *
   * @param {string} type - 日志类型
   * @returns {string} - 返回日志文件的完整路径
   */
  getLogPath(type) {
    const date = new Date().toISOString().split("T")[0];
    return path.join(this.logDir, `${this.siteName}_${type}_${date}.log`);
  }

  /**
   * 格式化消息
   *
   * @param message 要格式化的消息内容
   * @param type 消息类型
   * @returns 格式化后的消息字符串
   */
  formatMessage(message, type) {
    return `[${this.getTimestamp()}] [${type.toUpperCase()}] ${message}\n`;
  }

  /**
   * 记录日志到文件和控制台
   *
   * @param {string} message - 要记录的日志消息
   * @param {string} [type='info'] - 日志类型，默认为 'info'，可以是 'info', 'error' 等
   */
  log(message, type = "info") {
    if (!message) return;

    const formattedMessage = this.formatMessage(message, type);
    const logPath = this.getLogPath(type);

    try {
      // 确保日志目录存在
      mkdir(path.dirname(logPath));

      // 写入日志文件
      fs.appendFileSync(logPath, formattedMessage, "utf8");

      // 同时输出到控制台
      if (type === "error") {
        console.error(formattedMessage.trim());
      } else {
        console.log(formattedMessage.trim());
      }
    } catch (err) {
      console.error("写入日志失败:", err);
      // 尝试写入错误日志
      try {
        const errorLogPath = path.join(this.logDir, "logger_error.log");
        fs.appendFileSync(
          errorLogPath,
          `[${this.getTimestamp()}] 写入日志失败: ${
            err.message
          }\n原始消息: ${message}\n`,
          "utf8"
        );
      } catch (e) {
        console.error("写入错误日志也失败:", e);
      }
    }
  }

  /**
   * 打印信息日志
   *
   * @param {string} message - 要打印的信息内容
   */
  info(message) {
    this.log(message, "info");
  }

  /**
   * 记录错误信息
   *
   * @param {string} message 错误信息内容
   */
  error(message) {
    this.log(message, "error");
  }

  /**
   * 发出警告信息
   *
   * @param {string} message - 警告信息内容
   */
  warn(message) {
    this.log(message, "warn");
  }

  /**
   * 显示成功消息
   *
   * @param {string} message - 成功消息内容
   */
  success(message) {
    this.log(message, "success");
  }
}

export default Logger;