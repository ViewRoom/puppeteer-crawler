const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

/**
 * 写入文件到本地
 * @param {string} fileName 文件名称
 * @param {*} data 文件内容
 */
function writeFile(fileName, data) {
  fs.writeFileSync(path.join(__dirname + "/data", fileName), data);
}

/**
 * 保存图片到本地
 * @param {string} url 图片地址
 * @param {string} path 图片保存路径
 */
function saveImage(url, path) {
  https.get(url, function (req, res) {
    let imgData = "";
    req.on("data", function (chunk) {
      imgData += chunk;
    });
    req.setEncoding("binary");
    req.on("end", function () {
      fs.writeFile(path, imgData, "binary", function (err) {
        console.log("保存图片成功" + path);
      });
    });
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

export { writeFile, saveImage, scrollToBottom };
