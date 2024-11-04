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
 * @param {number} distance 每次滚动的距离(单位是px)，默认为600
 * @param {number} interval 每次滚动的时间间隔(单位是ms)，默认为500
 */
function scrollToBottom(distance = 600, interval = 500) {
  let totalHeight = 0;
  let timer = setInterval(() => {
    window.scrollBy(0, distance);
    totalHeight += distance;

    if (totalHeight >= document.body.scrollHeight) {
      clearInterval(timer);
      resolve();
    }
  }, interval);
}

export { mkdir, saveFile, saveImage, scrollToBottom };
