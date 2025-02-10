import fs from "fs";
import path from "path";
import https from "https";

/**
 * 创建目录
 * @param {string} filePath
 */
function mkdir(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
  } catch (error) {
    console.log("创建目录失败", error);
  }
}

/**
 * 写入文件到本地
 * @param {string} filePath 文件路径
 * @param {string} fileName 文件名称
 * @param {*} data 文件内容
 */
function saveFile(filePath, fileName, data) {
  mkdir(filePath + fileName);
  try {
    fs.writeFileSync(path.join(filePath, fileName), data);
  } catch (error) {
    console.log("保存文件失败", error);
  }
}

/**
 * 写入文件内容
 * @param {string} filePath 文件路径
 * @param {string} fileName 文件名称
 * @param {string} content 文件内容
 */
function appendFileContent(filePath, fileName, content) {
  mkdir(filePath + fileName);
  try {
    // 读取文件内容
    const data = fs.readFileSync(path.join(filePath, fileName));
    // 附加新内容
    const updatedContent = data + content;
    // 写回文件
    fs.writeFileSync(path.join(filePath, fileName), updatedContent);
  } catch (err) {
    console.error("文件操作出错:", err);
  }
}

/**
 * 保存图片到本地
 * @param {string} imgPath 图片保存路径
 * @param {string} imgName 图片名称
 * @param {string} imgUrl 图片地址
 */
function saveImage(imgPath, imgName, imgUrl) {
  const fullPath = imgPath + imgName;
  mkdir(fullPath);

  https
    .get(imgUrl, function (res) {
      let imgData = "";
      res.setEncoding("binary");
      res.on("data", function (chunk) {
        imgData += chunk;
      });
      res.on("end", function () {
        try {
          fs.writeFileSync(fullPath, imgData, "binary");
          console.log("保存图片成功", fullPath);
        } catch (err) {
          console.log("保存图片失败", err.message);
        }
      });
    })
    .on("error", function (err) {
      console.error("请求图片时发生错误:", err.message);
    });
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
  await sourcePage.$eval(selector, (el) => el.setAttribute("target", "_blank"));

  // 点击 a 标签
  await sourcePage.click(selector);

  // 等待新页面加载完成
  const newTarget = await browser.waitForTarget(
    (target) => target.url() === charactersHref
  );
  const targetPage = await newTarget.page();

  return targetPage;
}

/**
 * 将数字转换为中文
 * @param {number} num 数字
 * @returns {string} 中文数字
 */
function numberToChinese(num) {
  const numArr = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const unitArr = ["", "十", "百", "千", "万", "十万", "百万", "千万", "亿"];
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
  return result.replace(/零(千|百|十)/g, "零").replace(/零+/g, "零");
}

/**
 * 提取章节信息
 * @param {string | number} text 文本
 * @returns {{chapterNum: string, chapterName: string}|null}
 */
function extractChapterInfo(text) {
  // 处理纯数字章节的情况
  const numberOnlyRegex = /^(\d+)\s*(.*?)$/;
  const regex =
    /第\s*([\d零一二三四五六七八九十百千万亿]+)\s*章\s*(.*?)(?=\s*章|$)/;
  const match = text.match(regex) || text.match(numberOnlyRegex);

  if (match) {
    let chapterNum = match[1];
    if (!isNaN(Number(chapterNum))) {
      chapterNum = numberToChinese(Number(chapterNum));
    }
    let chapterName = match[2].trim();
    // 保留“番外”，删除其他括号及括号内的内容
    chapterName = chapterName
      .replace(/\（(?!(番外|一|二|三|四|五|六|七|八|九|十|\d+)).*?\）/g, "")
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

export {
  mkdir,
  saveFile,
  saveImage,
  scrollToBottom,
  getTargetPageByA,
  appendFileContent,
  numberToChinese,
  extractChapterInfo,
};
