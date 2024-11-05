import { saveImage, getTargetPageByA, scrollToBottom } from "../utils/tools.js";
/**
 * 获取状态数据
 * @param {Object} browser 浏览器对象
 * @param {String} brotatoBaseUrl 网站基础URL
 * @param {Object} brotatoPage 首页对象
 */
async function crawlStatsData(browser, brotatoBaseUrl, brotatoPage) {
  // 等待状态链接可点击
  const statsSelector = 'a[title="Stats"]';
  const statsPage = await getTargetPageByA(browser, brotatoPage, statsSelector);

  // 滚动到页面底部
  await scrollToBottom(statsPage);

  // 获取状态表格选择器
  const statsTableSelector = ".wikitable";

  // 等待状态表格加载完成
  await statsPage.waitForSelector(statsTableSelector);

  // 获取状态表格元素列表
  const statsTableEle = await statsPage.$$(statsTableSelector);

  // 获取状态表格行元素列表
  const statsTableRowEleList = await statsTableEle[1].$$("tbody > tr");

  // 初始化图片URL列表
  const imgUrls = [];

  // 遍历状态表格行元素列表
  for (const statsTableRowEle of statsTableRowEleList) {
    // 获取状态表格行元素中的单元格元素列表
    const statsTableTdEleList = await statsTableRowEle.$$("td");

    if (statsTableTdEleList.length > 0) {
      // 获取第一个单元格内图片
      const statsTableRowFirstEleImg = await statsTableTdEleList[0].$("img");

      // 获取图片的srcset属性值
      const srcset = await statsTableRowFirstEleImg.getProperty("srcset");
      const srcsetValue = await srcset.jsonValue();

      // 提取图片URL并添加到列表中
      const url = srcsetValue.split(",")[1].split(" ")[1].trim();
      if (url) imgUrls.push(url);
    }
  }

  // 保存状态图片
  const imgPath = "./brotato/stats/";
  const savePromises = imgUrls.map((url) => {
    // 拼接完整的图片URL
    const imgUrl = brotatoBaseUrl + url;
    // 提取图片名称
    let imgName = url.split("/").pop();
    imgName = imgName.split("-")[1] || imgName;
    // 调用函数保存图片
    return saveImage(imgPath, imgName, imgUrl);
  });

  await Promise.all(savePromises);
}

export { crawlStatsData };
