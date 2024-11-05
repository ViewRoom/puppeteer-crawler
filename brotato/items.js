import { saveImage, getTargetPageByA, scrollToBottom } from "../utils/tools.js";
/**
 * 获取物品数据
 * @param {Object} browser 浏览器对象
 * @param {String} brotatoBaseUrl 网站基础URL
 * @param {Object} brotatoPage 首页对象
 */
async function crawlItemsData(browser, brotatoBaseUrl, brotatoPage) {
  // 等待物品链接可点击
  const itemsSelector = 'a[title="Items"]';
  const itemsPage = await getTargetPageByA(browser, brotatoPage, itemsSelector);

  // 滚动到页面底部
  await scrollToBottom(itemsPage);

  // 获取物品表格选择器
  const itemsTableSelector = ".wikitable";

  // 等待物品表格加载完成
  await itemsPage.waitForSelector(itemsTableSelector);

  // 获取物品表格元素列表
  const itemsTableEleList = await itemsPage.$$(itemsTableSelector);

  // 获取一个元素
  const itemsTableEle = itemsTableEleList.shift();

  // 获取物品表格行元素列表
  const itemsTableRowEleList = await itemsTableEle.$$("tbody > tr");

  // 初始化图片URL列表
  const imgUrls = [];

  // 遍历物品表格行元素列表
  for (const itemsTableRowEle of itemsTableRowEleList) {
    // 获取物品表格行元素中的单元格元素列表
    const itemsTableTdList = await itemsTableRowEle.$$("td");

    if (itemsTableTdList.length > 0) {
      // 获取第一个单元格内图片
      const itemsTableRowFirstEleImg = await itemsTableTdList[0].$("img");

      // 获取图片的srcset属性值
      const srcset = await itemsTableRowFirstEleImg.getProperty("srcset");
      const srcsetValue = await srcset.jsonValue();

      // 提取图片URL并添加到列表中
      const url = srcsetValue.split(",")[1].split(" ")[1].trim();
      if (url) imgUrls.push(url);
    }
  }

  // 保存物品图片
  const imgPath = "./brotato/items/";
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

export { crawlItemsData };
