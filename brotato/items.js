import {
  saveFile,
  saveImage,
  getTargetPageByA,
  scrollToBottom,
} from "../utils/tools.js";
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

  // 物品信息列表
  const itemsInfoList = [];
  // 初始化图片URL列表
  const imgUrls = [];

  // 遍历物品表格行元素列表
  for (const itemsTableRowEle of itemsTableRowEleList) {
    // 物品信息
    const itemsInfo = {
      name: "",
      rarity: 0,
      effects: "",
      basePrice: 0,
      limit: 0,
      unlocked: null,
    };

    // 获取物品表格行元素中的单元格元素列表
    const itemsTableTdList = await itemsTableRowEle.$$("td");

    if (itemsTableTdList.length > 0) {
      for (let index = 0; index < itemsTableTdList.length; index++) {
        const itemsTableTd = itemsTableTdList[index];

        switch (index) {
          case 0:
            // 获取第一个单元格内图片
            const itemsTableRowFirstEleImg = await itemsTableTd.$("img");

            // 获取第一个单元格内图片的alt属性值
            const alt = await itemsTableRowFirstEleImg.getProperty("alt");
            const altValue = await alt.jsonValue();
            itemsInfo.name = altValue;

            // 获取图片的srcset属性值
            const srcset = await itemsTableRowFirstEleImg.getProperty("srcset");
            const srcsetValue = await srcset.jsonValue();
            // 提取图片URL并添加到列表中
            const url = srcsetValue.split(",")[1].split(" ")[1].trim();
            if (url) imgUrls.push(url);
            break;

          case 1:
            const rarity = await itemsPage.evaluate(
              (element) => element.textContent,
              itemsTableTd
            );
            // 获取物品稀有度
            itemsInfo.rarity = parseInt(rarity.trim().slice(-1));
            break;
          case 2:
            const effects = await itemsPage.evaluate(
              (element) => element.innerText,
              itemsTableTd
            );
            // 获取物品效果
            itemsInfo.effects = effects.trim();
            // 替换其中的数字
            const reg = /([+-]?\d+(\.\d+)?)([  ]?%)?/g;
            itemsInfo.effects = effects.replace(
              reg,
              (_match, number, _decimal, percentSign) => {
                // 根据是否有百分号来构建不同的替换字符串
                return percentSign ? `[${number}%]<>` : `[${number}]<>`;
              }
            );
            break;
          case 3:
            const basePrice = await itemsPage.evaluate(
              (element) => element.textContent,
              itemsTableTd
            );
            // 获取物品基础价格
            itemsInfo.basePrice = parseInt(basePrice.trim());
            break;
          case 4:
            const limit = await itemsPage.evaluate(
              (element) => element.textContent,
              itemsTableTd
            );
            // 获取物品上限
            itemsInfo.limit =
              parseInt(limit.trim()) > 0 ? parseInt(limit.trim()) : 0;
            break;

          case 5:
            const unlocked = await itemsPage.evaluate(
              (element) => element.textContent,
              itemsTableTd
            );
            // 获取物品解锁条件
            itemsInfo.unlocked =
              unlocked.trim().length > 0 ? unlocked.trim() : null;
            break;

          default:
            break;
        }
      }

      itemsInfoList.push({ ...itemsInfo });
    }
  }

  // 保存物品信息
  const itemsPath = "./brotato/data/items/";
  const fileName = "items.json";
  const fileData = JSON.stringify(itemsInfoList);
  saveFile(itemsPath, fileName, fileData);

  // 保存物品图片
  const imgPath = "./brotato/images/items/";
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
