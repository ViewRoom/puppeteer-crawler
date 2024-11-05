import { saveImage, getTargetPageByA, scrollToBottom } from "../utils/tools.js";
/**
 * 获取武器数据
 * @param {Object} browser 浏览器对象
 * @param {String} brotatoBaseUrl 网站基础URL
 * @param {Object} brotatoPage 首页对象
 */
async function crawlWeaponsData(browser, brotatoBaseUrl, brotatoPage) {
  // 等待武器链接可点击
  const weaponsSelector = 'a[title="Weapons"]';
  const weaponsPage = await getTargetPageByA(
    browser,
    brotatoPage,
    weaponsSelector
  );

  // 滚动到页面底部
  await scrollToBottom(weaponsPage);

  // 获取武器表格选择器
  const weaponsTableSelector = ".wikitable";

  // 等待武器表格加载完成
  await weaponsPage.waitForSelector(weaponsTableSelector);

  // 获取武器表格元素列表
  const weaponsTableEleList = await weaponsPage.$$(weaponsTableSelector);

  // 删除最后一个元素
  weaponsTableEleList.pop();

  // 初始化图片URL列表
  const imgUrls = [];

  for (const weaponsTableEle of weaponsTableEleList) {
    // 获取武器表格行元素列表
    const weaponsTableRowEleList = await weaponsTableEle.$$("tbody > tr");

    // 遍历武器表格行元素列表
    for (const weaponsTableRowEle of weaponsTableRowEleList) {
      // 获取武器表格行元素中的单元格元素列表
      const weaponsTableTdList = await weaponsTableRowEle.$$("td");

      if (weaponsTableTdList.length > 0) {
        // 获取第一个单元格内图片
        const weaponsTableRowFirstEleImg = await weaponsTableTdList[0].$("img");

        // 获取图片的srcset属性值
        const srcset = await weaponsTableRowFirstEleImg.getProperty("srcset");
        const srcsetValue = await srcset.jsonValue();

        // 提取图片URL并添加到列表中
        const url = srcsetValue.split(",")[1].split(" ")[1].trim();
        if (url) imgUrls.push(url);
      }
    }
  }

  // 保存武器图片
  const imgPath = "./brotato/weapons/";
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

export { crawlWeaponsData };
