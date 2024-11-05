import { saveImage, getTargetPageByA, scrollToBottom } from "../utils/tools.js";
/**
 * 获取难度数据
 * @param {Object} browser 浏览器对象
 * @param {String} brotatoBaseUrl 网站基础URL
 * @param {Object} brotatoPage 首页对象
 */
async function crawlDangersData(browser, brotatoBaseUrl, brotatoPage) {
  // 等待难度链接可点击
  const dangersSelector = 'a[title="Dangers"]';
  const dangersPage = await getTargetPageByA(
    browser,
    brotatoPage,
    dangersSelector
  );

  // 滚动到页面底部
  await scrollToBottom(dangersPage);

  // 获取难度表格选择器
  const dangersTableSelector = ".wikitable";

  // 等待难度表格加载完成
  await dangersPage.waitForSelector(dangersTableSelector);

  // 获取难度表格元素列表
  const dangersTableEle = await dangersPage.$(dangersTableSelector);

  // 获取难度表格行元素列表
  const dangersTableRowEleList = await dangersTableEle.$$("tbody > tr");

  // 初始化图片URL列表
  const imgUrls = [];

  // 遍历难度表格行元素列表
  for (const dangersTableRowEle of dangersTableRowEleList) {
    // 获取难度表格行元素中的单元格元素列表
    const dangersTableTdList = await dangersTableRowEle.$$("td");

    if (dangersTableTdList.length > 0) {
      // 获取第二个单元格内图片
      const dangersTableRowFirstEleImg = await dangersTableTdList[1].$("img");

      // 获取图片的srcset属性值
      const srcset = await dangersTableRowFirstEleImg.getProperty("srcset");
      const srcsetValue = await srcset.jsonValue();

      // 提取图片URL并添加到列表中
      const url = srcsetValue.split(",")[1].split(" ")[1].trim();
      if (url) imgUrls.push(url);
    }
  }

  // 保存难度图片
  const imgPath = "./brotato/dangers/";
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

export { crawlDangersData };
