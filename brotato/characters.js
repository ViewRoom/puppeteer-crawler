import { saveImage } from "../utils/tools.js";

/**
 * 获取角色数据
 * @param {Object} browser 浏览器对象
 * @param {String} brotatoBaseUrl 网站基础URL
 * @param {Object} brotatoPage 首页对象
 */
async function crawlCharactersData(browser, brotatoBaseUrl, brotatoPage) {
  // 等待角色链接可点击
  const charactersSelector = 'a[title="Characters"]';
  await brotatoPage.waitForSelector(charactersSelector);

  // 获取角色链接
  const charactersHref = await brotatoPage.$eval(
    charactersSelector,
    (el) => el.href
  );

  // 在新标签页中打开
  await brotatoPage.$eval(
    charactersSelector,
    (el, value) => el.setAttribute("target", value),
    "_blank"
  );

  // 点击角色链接
  await brotatoPage.click(charactersSelector);

  // 等待角色页面加载完成
  const target = await browser.waitForTarget((t) => t.url() === charactersHref);
  const charactersPage = await target.page();

  // 获取角色表格选择器
  const charactersTableSelector = ".navbox-characters";
  // 等待角色表格加载完成
  await charactersPage.waitForSelector(charactersTableSelector);
  // 获取角色表格元素
  const charactersTableEle = await charactersPage.$(charactersTableSelector);

  // 获取角色图片列表
  const charactersImgList = await charactersTableEle.$$("img");

  // 初始化图片URL列表
  const imgUrls = [];

  // 如果角色图片列表长度大于0
  if (charactersImgList?.length > 0) {
    for (const img of charactersImgList) {
      const srcset = await charactersPage.evaluate(
        (element) => element.srcset,
        img
      );

      // 提取图片URL并添加到列表中
      imgUrls.push(srcset.split(",")[1].split(" ")[1].trim());
    }
  }

  // 保存角色图片
  for (const url of imgUrls) {
    // 拼接完整的图片URL
    const imgUrl = brotatoBaseUrl + url;
    // 提取图片名称
    let imgName = url.split("/").pop();
    imgName = imgName.split("-")[1] || imgName;
    // 图片保存路径
    const imgPath = "./brotato/characters/";

    // 调用函数保存图片
    saveImage(imgPath, imgName, imgUrl);
  }
}

export { crawlCharactersData };
