import { saveImage, getTargetPageByA, scrollToBottom } from "../utils/tools.js";
/**
 * 获取敌人数据
 * @param {Object} browser 浏览器对象
 * @param {String} brotatoBaseUrl 网站基础URL
 * @param {Object} brotatoPage 首页对象
 */
async function crawlEnemiesData(browser, brotatoBaseUrl, brotatoPage) {
  // 等待敌人链接可点击
  const enemiesSelector = 'a[title="Enemies"]';
  const enemiesPage = await getTargetPageByA(
    browser,
    brotatoPage,
    enemiesSelector
  );

  // 滚动到页面底部
  await scrollToBottom(enemiesPage);

  // 获取敌人表格选择器
  const enemiesTableSelector = ".wikitable";

  // 等待敌人表格加载完成
  await enemiesPage.waitForSelector(enemiesTableSelector);

  // 获取敌人表格元素列表
  const enemiesTableEleList = await enemiesPage.$$(enemiesTableSelector);

  // 删除不需要的表格元素
  enemiesTableEleList.length = 6;

  // 初始化图片URL列表
  const imgUrls = [];

  for (const enemiesTableEle of enemiesTableEleList) {
    // 获取敌人表格行元素列表
    const enemiesTableRowEleList = await enemiesTableEle.$$("tbody > tr");

    // 遍历敌人表格行元素列表
    for (const enemiesTableRowEle of enemiesTableRowEleList) {
      // 获取敌人表格行元素中的单元格元素列表
      const enemiesTableTdList = await enemiesTableRowEle.$$("td");

      if (enemiesTableTdList.length > 0) {
        // 获取第一个单元格内图片
        const enemiesTableRowFirstEleImg = await enemiesTableTdList[0].$("img");

        // 获取图片的src属性值
        const src = await enemiesTableRowFirstEleImg.getProperty("src");
        const url = await src.jsonValue();
        if (url) imgUrls.push(url);
      }
    }
  }

  // 保存敌人图片
  const imgPath = "./brotato/enemies/";
  const savePromises = imgUrls.map((url) => {
    // 提取图片名称
    let imgName = url.split("/").pop();
    imgName = imgName.split("-")[1] || imgName;
    // 调用函数保存图片
    return saveImage(imgPath, imgName, url);
  });

  await Promise.all(savePromises);
}

export { crawlEnemiesData };
