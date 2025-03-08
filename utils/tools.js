import fs from "fs";
import path from "path";
import https from "https";

/**
 * 创建目录
 * @param {string} dirPath 目录路径
 */
function mkdir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  } catch (error) {
    console.error("创建目录失败", error);
    throw error;
  }
}

/**
 * 写入文件到本地
 * @param {string} filePath 文件路径
 * @param {string} fileName 文件名称
 * @param {*} data 文件内容
 */
function saveFile(filePath, fileName, data) {
  const fullPath = path.join(filePath, fileName);
  mkdir(path.dirname(fullPath));
  try {
    fs.writeFileSync(fullPath, data, "utf8");
  } catch (error) {
    console.error("保存文件失败", error);
    throw error;
  }
}

/**
 * 追加文件内容
 * @param {string} filePath 文件路径
 * @param {string} fileName 文件名称
 * @param {string} content 文件内容
 */
function appendFileContent(filePath, fileName, content) {
  const fullPath = path.join(filePath, fileName);
  mkdir(path.dirname(fullPath));
  try {
    fs.appendFileSync(fullPath, content, "utf8");
  } catch (err) {
    console.error("文件操作出错:", err);
    throw err;
  }
}

/**
 * 保存图片到本地
 * @param {string} imgPath 图片保存路径
 * @param {string} imgName 图片名称
 * @param {string} imgUrl 图片地址
 */
async function saveImage(imgPath, imgName, imgUrl) {
  const fullPath = path.join(imgPath, imgName);
  mkdir(path.dirname(fullPath));

  try {
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(fullPath);
      https
        .get(imgUrl, function (res) {
          res.pipe(file);
          file.on("finish", () => {
            file.close();
            resolve();
            console.log("保存图片成功", fullPath);
          });
          file.on("error", function (err) {
            fs.unlink(fullPath); // 删除不完整的文件
            console.error("保存图片失败", err.message);
            reject(err);
          });
        })
        .on("error", function (err) {
          console.error("请求图片时发生错误:", err.message);
          reject(err);
        });
    });
  } catch (err) {
    throw err;
  }
}

/**
 * 页面滚动到底部
 * @param {Object} page 页面对象
 * @param {number} distance 每次滚动的距离(单位是px)，默认为600
 * @param {number} interval 每次滚动的时间间隔(单位是ms)，默认为500
 */
async function scrollToBottom(page, distance = 600, interval = 500) {
  return await page.evaluate(
    ({ distance, interval }) => {
      return new Promise((resolve) => {
        let totalHeight = 0;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, interval);
      });
    },
    { distance, interval }
  );
}

/**
 * 获取目标页面
 * @param {Object} browser 浏览器
 * @param {Object} sourcePage 源页面
 * @param {string} selector 选择器
 * @returns {Object} 目标页面
 */
async function getTargetPageByA(browser, sourcePage, selector) {
  // 等待 a 标签出现
  await sourcePage.waitForSelector(selector);

  // 获取 a 标签的 href 属性
  const charactersHref = await sourcePage.$eval(selector, (el) => el.href);

  // 在新标签页中打开链接
  const [newPage] = await Promise.all([
    browser.waitForTarget((target) => target.url().startsWith(charactersHref)),
    sourcePage.click(selector),
  ]);

  return newPage;
}

/**
 * 将数字转换为中文
 * @param {number} num 数字
 * @returns {string} 中文数字
 */
function numberToChinese(num) {
  const numArr = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const unitArr = ["", "十", "百", "千", "万", "十万", "百万"];
  let result = "";
  let index = 0;
  while (num > 0) {
    const digit = num % 10;
    if (digit !== 0) {
      result = numArr[digit] + unitArr[index] + result;
    } else if (result.charAt(0) !== numArr[0]) {
      result = numArr[0] + result;
    }
    num = Math.floor(num / 10);
    index++;
  }
  if (result === "") {
    result = numArr[0];
  }
  return result.replace(/零(百万|十万|万|千|百|十)/g, "零").replace(/零+/g, "");
}

/**
 * 提取章节信息
 * @param {string | number} text 文本
 * @returns {{chapterNum: string, chapterName: string}|null}
 */
function extractChapterInfo(text) {
  const regex = /^第?\s*([\d零一二三四五六七八九十百千万]+)\s*章?\s*(.*?)$/;
  const match = text.match(regex);

  if (match) {
    let chapterNum = match[1];
    if (!isNaN(Number(chapterNum))) {
      chapterNum = numberToChinese(Number(chapterNum));
    }
    let chapterName = match[2].trim();
    // 保留特殊字符串，删除其他括号及括号内的内容
    chapterName = chapterName
      .replace(
        /\（(?!(番外|一|二|三|四|五|六|七|八|九|十|上|中|下|\d+)).*?\）/g,
        ""
      )
      .trim();
    if (chapterName === "") {
      chapterName = "无题";
    }
    return { chapterNum, chapterName };
  } else {
    // 处理没有“第xx章”格式，但有“番外”内容的情况
    if (text.includes("番外")) {
      return { chapterNum: "", chapterName: text.trim() };
    }
    return null;
  }
}

/**
 * 从给定URL中提取并解码小说名称
 * @param {string} url - 包含小说名称查询参数的URL
 * @returns {string} - 解码后的小说名称
 */
function extractNovelsNameFromUrl(url) {
  try {
    // 创建一个URL对象
    const urlObject = new URL(url);

    // 获取查询参数对象
    const params = new URLSearchParams(urlObject.search);

    // 提取novels_name参数的值
    const novelsNameEncoded = params.get("novels_name");

    if (!novelsNameEncoded) {
      throw new Error("查询参数中不存在novels_name");
    }

    // 对值进行URL解码
    const novelsNameDecoded = decodeURIComponent(novelsNameEncoded);

    // 返回解码后的小说名称
    return novelsNameDecoded;
  } catch (error) {
    // 捕获并处理错误
    console.error("提取小说名称时出错:", error.message);
    return null; // 或者根据需要返回其他错误指示值
  }
}

export {
  mkdir,
  saveFile,
  saveImage,
  scrollToBottom,
  getTargetPageByA,
  appendFileContent,
  numberToChinese,
  extractChapterInfo,
  extractNovelsNameFromUrl,
};
