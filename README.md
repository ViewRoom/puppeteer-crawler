# Puppeteer Crawler

拾页：基于 TypeScript、Puppeteer 和 SQLite 的单机小说采集工作台，提供 React Web 管理界面和 CLI。支持多站点配置、目录与正文分页、断点续爬、增量更新、失败重试、定时检查和 TXT/JSON 导出。

## 环境与安装

- Node.js **24 或更新版本**，推荐 Node.js 24 LTS。
- npm；首次安装会下载 Puppeteer 对应的 Chrome，需要可访问下载源。

```bash
npm ci
npm start -- --help
npm start -- sites
```

如果使用已有浏览器，可以设置 `PUPPETEER_SKIP_DOWNLOAD=true` 安装，再通过 `PUPPETEER_EXECUTABLE_PATH` 指定 Chrome/Chromium 可执行文件。SQLite 使用 Node.js 内置的 `node:sqlite`，部分 Node 版本会打印实验特性提示。

## Web 管理台（方案 B）

```bash
npm ci
npm run web
```

打开 **http://127.0.0.1:7777**。`npm run web`会构建界面并启动 API 和独立采集 Worker；端口可通过`PORT`修改，数据目录可通过`CRAWLER_DATA_DIR` 修改。

- **工作概览**：书籍、章节与任务统计，查看最近采集进度。
- **我的书库**：搜索书籍、分页查看和搜索目录，阅读已采集章节，检查更新。
- **采集任务**：持久化队列、进度和错误明细，暂停、继续、补采失败章节、取消及最近 100 条日志。
- **站点管理**：编辑或添加规则，支持完整 JSON 配置；用目录和第一章预览验证规则，不写入书库。
- **定时计划**：按分钟间隔增量采集，可启停、立即执行或删除；服务关闭后保留计划，下次启动对到期计划补执行一次。
- **导出中心**：生成 TXT/JSON、保留成功或失败记录，下载已生成文件。缺章导出需要显式勾选。

例如采集冰峰小说的《从水猴子开始成神》：

1. 点击“新建采集任务”，来源选择 `bingfengxs`。
2. 目录地址填入 `http://www.bingfengxs.com/198/198226/`，点击“开始采集”。
3. 在任务页查看进度；可暂停后继续，失败时可补采。
4. 完成后在“导出中心”新建导出，选择书籍和格式，再下载文件。

内置冰峰规则也可在“站点管理 → 编辑与测试”中预览。新任务使用当前保存的规则；继续或补采任务时，也会采用站点的最新规则。已经保存的目录保持不变。只修改规则不会自动启动采集。

API 和 Worker 为独立进程，共用 SQLite。任务按入队顺序逐个运行，单个任务的章节按配置并发。关闭服务会保存进度；正在运行的任务在重启后标记为“待恢复”，需手动继续，排队任务自动继续。取消会保留已有章节，允许重新创建采集任务。

Web Worker 运行期间占用同数据库的采集锁。此时 CLI 可以查询和导出；要用 CLI 执行采集，请先关闭 Web 服务。如果 CLI 已在采集，Web 会保留队列并等待 CLI 退出。Web 也能请求暂停正在运行的本项目 CLI 任务。

当前界面面向**本机单用户**，默认仅监听 `127.0.0.1`，并校验 Host 和修改请求的 Origin；没有账号和权限系统。不要直接发布到公网。SQLite 旧版本数据会在启动时自动迁移，保留原有书籍、正文和任务，并导入任务中的自定义站点配置；升级前建议备份数据目录。

开发时分别启动 API 和 Vite（Vite 将 `/api` 代理至本机 7777）：

```bash
npm run server:dev
# 另一个终端
npm run dev
# 打开 http://127.0.0.1:5173
```

生产启动不依赖 TypeScript 工具：

```bash
npm run build
npm run start:web
```

## 常用操作

```bash
# 采集某站点的默认书籍，或指定目录地址
npm start -- crawl --site deqixs
npm start -- crawl --site deqixs --url 'https://www.deqixs.com/xiaoshuo/250/'

# 查看任务；详情包含失败与未完成章节、错误及尝试次数
npm start -- tasks
npm start -- tasks <任务ID>
npm start -- books

# 恢复中断任务；失败章节需要显式补采
npm start -- resume <任务ID>
npm start -- retry <任务ID> --failed

# 站点结构变化时，可修正配置后继续原任务
npm start -- --config ./my-site.json retry <任务ID>

# 同一目录再次采集：更新目录，只下载新增及缺失章节
npm start -- crawl --site deqixs

# 强制刷新正文，刷新失败仍保留旧正文
npm start -- crawl --site deqixs --refresh --concurrency 2

# 独立导出，书籍ID可通过 books 查询
npm start -- export <书籍ID>
npm start -- export <书籍ID> --format json
npm start -- export <书籍ID> --output ./novels/book.txt

# 默认拒绝缺章导出；显式允许时在结果中标明缺章
npm start -- export <书籍ID> --allow-partial

# 可选：顺序采集所有站点的默认书籍
npm start -- crawl --all
```

站点采集统一使用 `npm start -- crawl --site <站点名>`，采集全部站点使用 `npm start -- crawl --all`。旧入口 `node index.js deqixs` 仍可使用。无参数启动现在显示帮助，不再自动采集全部站点。采集不会自动覆盖旧 TXT，需要执行 `export`。

采集完成会显示任务 ID、书籍 ID 和成功、跳过、失败、未完成数量。任一章节失败，任务标为 `failed` 并返回退出码 `1`。按 `Ctrl+C` 或收到 `SIGTERM` 时停止并保留进度，返回退出码 `130`；强制结束进程后，下次执行采集类命令会恢复遗留状态。`resume` 继续未完成部分，`retry` 同时处理失败和未完成部分。

同一数据库只允许一个采集进程；不同站点顺序执行，章节按配置并发。可以同时查询任务或导出。已有未完成任务的书籍不能重复创建任务，先使用 `resume` / `retry`。每个任务保留创建时的配置，恢复时无需重复传入配置文件；显式传入 `--config` 时，文件必须包含任务所属站点，校验后更新配置快照。已保存的目录保持不变，未完成的目录会重新获取。

## 自定义站点

复制 [examples/site.json](examples/site.json)，修改地址和 CSS 选择器：

```bash
npm start -- --config ./examples/site.json sites
npm start -- --config ./examples/site.json crawl --site example --url 'https://example.com/book/'
```

配置文件支持单个站点对象或站点数组；同名站点覆盖内置配置。配置采用严格校验，未知字段、非 HTTP(S) 地址、非法并发等会在任务创建前报错。

冰峰小说的示例配置已放在 [examples/bingfengxs.json](examples/bingfengxs.json)：

```bash
npm start -- --config ./examples/bingfengxs.json crawl --site bingfengxs
```

该配置使用 `transport: "http"`，直接获取静态 HTML，再由 Chromium 解析，不执行网页脚本或加载嵌入资源。适用于正文已经包含在 HTML 中的页面，可以避免浏览器自动升级 HTTP 地址导致的访问问题；依赖 JavaScript 渲染的站点继续使用默认的 `browser` 模式。HTTP 模式仍需安装浏览器用于 DOM 解析，HTTPS 请求仍校验证书。

| 字段                       | 含义                                   | 默认值                                   |
| -------------------------- | -------------------------------------- | ---------------------------------------- |
| `name`                     | 站点唯一名称                           | 必填                                     |
| `transport`                | `browser` 浏览器导航或 `http` 静态获取 | `browser`                                |
| `baseUrls`                 | 默认书籍目录地址                       | `[]`，可用 `--url` 指定                  |
| `selectors.novelTitle`     | 书名选择器                             | 使用 URL 的 `novels_name` 参数或页面标题 |
| `selectors.chapterList`    | 目录中的章节链接                       | 必填                                     |
| `selectors.chapterContent` | 正文容器                               | 必填                                     |
| `selectors.remove`         | 在正文容器内移除的广告等元素           | `[]`                                     |
| `pagination.catalog`       | 目录下一页规则                         | 不翻页                                   |
| `pagination.content`       | 单章正文下一页规则                     | 不翻页                                   |
| `pagination.*.selector`    | 下一页链接 CSS 选择器                  | 配置翻页时必填                           |
| `pagination.*.text`        | 下一页文本，严格匹配                   | 不限制文本                               |
| `pagination.*.maxPages`    | 最大页数，超限显式失败                 | `1000`                                   |
| `request.timeoutMs`        | 导航/元素等待超时                      | `30000`                                  |
| `request.retries`          | 失败后的额外重试次数                   | `3`                                      |
| `request.retryDelayMs`     | 退避初始间隔，指数递增，上限 60 秒     | `1000`                                   |
| `request.intervalMs`       | 同一站点各页面导航起始时间的最小间隔   | `500`                                    |
| `concurrency`              | 并发章节数，1–20                       | `2`                                      |

下一页必须是带有 `href` 的链接；通过读取地址导航，避免点击后错过导航事件。`aria-disabled="true"` 或 `disabled` 视为末页。正文分页推荐设置 `text`，防止把“下一章”误当作“下一页”。目录链接按去除 URL 片段后的完整地址去重，保留目录原始顺序和标题，包括序章、番外。循环分页、超出页数或空正文会显式失败。

对临时错误、HTTP 408/429 和 5xx 执行退避重试；其他 HTTP 4xx、循环分页、分页超限不会自动重试。目录按页重试；正文以整章为单位重试，只有所有分页成功后才写入该章。

内置 `bingfengxs` 已验证目录和前三章（站点结构后续仍可能变化）；另外三个站点沿用旧项目的地址与选择器，**未验证这些外部站点当前可用性**，可能需要更新配置。当前适配器支持链接分页，不包含点击事件分页、登录或验证码处理。

## 数据与导出

默认数据目录是当前工作目录下的 `data/`，可通过全局参数 `--data-dir <路径>` 或环境变量 `CRAWLER_DATA_DIR` 修改。

```text
data/
  crawler.sqlite       # 书籍、章节、任务、站点、队列、日志、计划、导出记录和进程锁
  crawler.sqlite-wal   # 运行期间的 SQLite WAL
  crawler.sqlite-shm
  logs/YYYY-MM-DD.jsonl
  exports/书名-书籍ID前缀.txt
  exports/导出记录UUID.txt  # Web 下载通过记录中的原始文件名返回
```

目录完整获取后才事务性更新章节清单；采集到的正文逐章提交。重复采集按站点名和规范化目录 URL 识别书籍，按章节 URL 复用已有正文。目录中消失的章节保留在数据库，但不再包含在当前导出结果中。URL 改变的章节会作为新章节采集。

TXT/JSON 按当前目录顺序导出。先写同目录的唯一临时文件，成功后原子替换目标文件。默认缺章时不触碰现有文件；`--refresh` 失败时旧正文仍可导出，可通过任务详情和 JSON 的 `fetchedAt` 判断数据时间。

旧版 `novels/*.txt` 不会被删除或自动导入。备份建议停止采集后使用 SQLite 备份工具，或一致性备份整个数据目录；不要在运行时只复制主数据库文件而遗漏 WAL。

## 开发与验证

```bash
npm test
npm run build
# 一次执行类型检查、测试、构建与格式检查
npm run check
# 自动格式化
npm run format
```

测试包含真实 Chromium + 本地 HTTP 页面，覆盖分页、去重、顺序、广告移除、失败重试、跨进程补采、持久化恢复、增量更新、并发限制、进程互斥和导出保护；还覆盖旧数据迁移、队列与暂停竞争、本机 API 校验、独立 Worker、定时调度和文件下载，不访问真实小说站点。Linux CI 如受 Chrome 沙箱限制，可以显式设置 `CRAWLER_NO_SANDBOX=1`。

```text
src/
  cli/              # 参数解析、命令输出、信号与生命周期
  application/      # 采集、恢复、补采与并发调度
  domain/           # 类型、状态与错误
  adapters/         # 站点配置与校验
  infrastructure/
    browser/        # 浏览器、页面解析、限速与重试
    storage/        # SQLite 与采集进程锁
    logging/        # JSON 日志
  exporters/        # TXT/JSON 原子导出
  server/           # Fastify API、Worker 监管与站点预览子进程
  shared/           # 前后端数据契约（类型）
web/                # React + Vite 管理界面
tests/fixtures/     # 可复现的本地页面样本
```

生产运行使用构建产物，避免依赖 TypeScript 开发工具：

```bash
npm ci
npm run build
node dist/cli/index.js sites
node dist/cli/index.js crawl --site deqixs
```

## Docker

镜像使用 Node.js 24 和系统 Chromium，运行数据挂载至 `/app/data`：

```bash
docker build -t puppeteer-crawler .
docker run --rm --init --cap-add=SYS_ADMIN -v "$PWD/data:/app/data" puppeteer-crawler sites
docker run --rm --init --cap-add=SYS_ADMIN -v "$PWD/data:/app/data" puppeteer-crawler crawl --site deqixs

# Web 管理台：容器内监听所有接口，宿主机仅发布至本机
docker run --rm --init --cap-add=SYS_ADMIN \
  -e HOST=0.0.0.0 -p 127.0.0.1:7777:7777 \
  -v "$PWD/data:/app/data" \
  --entrypoint node puppeteer-crawler dist/server/index.js
```

Chrome 沙箱在容器中需要运行环境支持；上述命令为沙箱提供所需能力。受限环境可显式传入 `-e CRAWLER_NO_SANDBOX=1` 并移除该能力，此时浏览器沙箱关闭。挂载目录需允许容器内的 `node` 用户（UID 1000）写入。自定义配置可只读挂载后通过 `--config` 指定。

当前版本支持单机 Web + CLI；分布式 Worker、多用户权限、EPUB 导出暂未包含。定时任务依赖服务持续运行。
