import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  Globe2,
  Pencil,
  Play,
  Save,
  FlaskConical,
  Download,
  Trash2,
  Pause,
  ArrowUpRight,
  Code2,
  SlidersHorizontal,
} from "lucide-react";
import type { SiteConfig } from "../../../src/adapters/config.js";
import { siteSchema } from "../../../src/shared/site-schema.js";
import type {
  PreviewResult,
  Schedule,
  ExportRecord,
} from "../../../src/shared/contracts.js";
import type { TaskSummary } from "../../../src/domain/models.js";
import { useApp } from "../lib/context.js";
import { api, date, number } from "../lib/api.js";
import {
  Button,
  Dialog,
  Empty,
  FormError,
  PageTitle,
  Status,
} from "../components/ui.js";

export function Sites() {
  const { data, openTask } = useApp();
  const [editing, setEditing] = useState<SiteConfig | null>(null);
  const [isNew, setIsNew] = useState(false);
  function create() {
    setIsNew(true);
    setEditing({
      name: "",
      baseUrls: [],
      transport: "browser",
      pagination: {},
      selectors: {
        novelTitle: "h1",
        chapterList: ".chapters a",
        chapterContent: "#content",
        remove: [],
      },
      request: {
        intervalMs: 1000,
        retries: 3,
        retryDelayMs: 1000,
        timeoutMs: 30000,
      },
      concurrency: 2,
    });
  }
  return (
    <>
      <PageTitle
        title="站点管理"
        action={
          <Button onClick={create}>
            <Plus size={18} />
            添加站点
          </Button>
        }
      />
      <div className="site-grid">
        {data!.sites.map(({ name, config }) => (
          <article className="panel site-card" key={name}>
            <div className="site-card-header">
              <Globe2 size={21} strokeWidth={1.5} />
              <h2>{name}</h2>
            </div>
            <p className="site-domain">
              {config.baseUrls[0]
                ? new URL(config.baseUrls[0]).hostname
                : "自定义来源"}
            </p>
            <div className="site-actions">
              <Button
                kind="secondary"
                onClick={() => {
                  setIsNew(false);
                  setEditing(config);
                }}
              >
                <Pencil size={15} />
                编辑与测试
              </Button>
              <Button kind="ghost" onClick={() => openTask(name)}>
                <Plus size={16} />
                新建任务
              </Button>
            </div>
          </article>
        ))}
      </div>
      {editing && (
        <SiteEditor
          initial={editing}
          isNew={isNew}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function SiteEditor({
  initial,
  isNew,
  onClose,
}: {
  initial: SiteConfig;
  isNew: boolean;
  onClose: () => void;
}) {
  const { refresh, notify } = useApp();
  const [config, setConfig] = useState(initial);
  const [advanced, setAdvanced] = useState(false);
  const [json, setJson] = useState(JSON.stringify(initial, null, 2));
  const [url, setUrl] = useState(initial.baseUrls[0] || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  function current(): SiteConfig {
    return siteSchema.parse(advanced ? JSON.parse(json) : config);
  }
  function switchMode() {
    try {
      if (advanced) setConfig(current());
      else setJson(JSON.stringify(config, null, 2));
      setAdvanced(!advanced);
      setError("");
    } catch {
      setError("配置结构或字段不正确，请修正后再切换");
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setError("");
    try {
      const value = current();
      await api(
        `/sites/${encodeURIComponent(isNew ? value.name : initial.name)}`,
        { method: "PUT", body: value },
      );
      await refresh();
      notify("站点配置已保存，后续任务将使用新规则");
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function test() {
    setBusy("preview");
    setError("");
    setPreview(null);
    try {
      setPreview(
        await api<PreviewResult>("/sites/preview", {
          method: "POST",
          body: { config: current(), url },
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }
  function selector(
    key: "novelTitle" | "chapterList" | "chapterContent",
    value: string,
  ) {
    setConfig({
      ...config,
      selectors: {
        ...config.selectors,
        [key]: key === "novelTitle" && !value ? undefined : value,
      },
    });
  }
  return (
    <Dialog
      title={isNew ? "添加采集站点" : `编辑站点 · ${initial.name}`}
      subtitle="规则保存前，可先抓取目录与第一章检查效果。"
      wide
      onClose={onClose}
    >
      <form className="form-body" onSubmit={(event) => void save(event)}>
        <div className="editor-toolbar">
          <span>采集规则</span>
          <Button type="button" kind="ghost" onClick={switchMode}>
            {advanced ? <SlidersHorizontal size={16} /> : <Code2 size={16} />}
            {advanced ? "表单编辑" : "完整 JSON"}
          </Button>
        </div>
        {advanced ? (
          <label>
            完整站点配置
            <textarea
              className="code-editor"
              aria-label="站点 JSON 配置"
              rows={18}
              spellCheck={false}
              value={json}
              onChange={(event) => setJson(event.target.value)}
            />
            <span className="field-hint">
              分页规则和广告移除规则可在这里配置，字段说明见项目 README。
            </span>
          </label>
        ) : (
          <>
            <div className="form-grid">
              <label>
                站点名称
                <input
                  required
                  readOnly={!isNew}
                  placeholder="例如 bingfengxs"
                  value={config.name}
                  onChange={(event) =>
                    setConfig({ ...config, name: event.target.value })
                  }
                />
              </label>
              <label>
                采集方式
                <select
                  value={config.transport}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      transport: event.target.value as SiteConfig["transport"],
                    })
                  }
                >
                  <option value="browser">浏览器 · 支持动态页面</option>
                  <option value="http">静态 HTML · 不执行脚本</option>
                </select>
              </label>
            </div>
            <label>
              默认目录地址
              <input
                type="url"
                value={config.baseUrls[0] || ""}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    baseUrls: event.target.value
                      ? [event.target.value, ...config.baseUrls.slice(1)]
                      : [],
                  })
                }
                placeholder="https://example.com/book/"
              />
            </label>
            <div className="form-grid">
              <label>
                书名选择器
                <input
                  value={config.selectors.novelTitle || ""}
                  placeholder="h1"
                  onChange={(event) =>
                    selector("novelTitle", event.target.value)
                  }
                />
              </label>
              <label>
                章节链接选择器
                <input
                  required
                  value={config.selectors.chapterList}
                  onChange={(event) =>
                    selector("chapterList", event.target.value)
                  }
                />
              </label>
              <label>
                正文容器选择器
                <input
                  required
                  value={config.selectors.chapterContent}
                  onChange={(event) =>
                    selector("chapterContent", event.target.value)
                  }
                />
              </label>
              <label>
                章节并发数
                <input
                  type="number"
                  min={1}
                  max={20}
                  required
                  value={config.concurrency}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      concurrency: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                请求间隔（毫秒）
                <input
                  type="number"
                  min={0}
                  required
                  value={config.request.intervalMs}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      request: {
                        ...config.request,
                        intervalMs: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
              <label>
                失败重试次数
                <input
                  type="number"
                  min={0}
                  max={10}
                  required
                  value={config.request.retries}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      request: {
                        ...config.request,
                        retries: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
            </div>
          </>
        )}
        <div className="preview-box">
          <h3>
            <FlaskConical size={17} />
            采集预览
          </h3>
          <div className="input-action">
            <input
              type="url"
              aria-label="测试目录地址"
              placeholder="填入待测试的目录地址"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
            <Button
              type="button"
              kind="secondary"
              disabled={!!busy || !url}
              onClick={() => void test()}
            >
              {busy === "preview" ? "测试中…" : "测试规则"}
            </Button>
          </div>
          <p className="field-hint">
            仅读取目录和第一章，不保存为采集任务；最长等待 30 秒。
          </p>
          {preview && (
            <div className="preview-result">
              <span className="tag tag-success">解析成功</span>
              <h3>{preview.title}</h3>
              <p>
                发现 {number(preview.total)} 章 · 首章{" "}
                {number(preview.sample.characters)} 字
              </p>
              <ul>
                {preview.chapters.map((chapter) => (
                  <li key={chapter.url}>{chapter.title}</li>
                ))}
              </ul>
              <strong>{preview.sample.title}</strong>
              <pre>{preview.sample.text}</pre>
            </div>
          )}
        </div>
        <FormError message={error} />
        <div className="dialog-footer">
          <Button
            type="button"
            kind="secondary"
            disabled={!!busy}
            onClick={onClose}
          >
            取消
          </Button>
          <Button type="submit" disabled={!!busy}>
            <Save size={16} />
            {busy === "save" ? "正在保存…" : "保存站点"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function Schedules() {
  const { data, refresh, notify } = useApp();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState("");
  async function change(item: Schedule, action: "toggle" | "run" | "delete") {
    setBusy(item.id);
    try {
      const result = await api<TaskSummary>(
        `/schedules/${item.id}${action === "run" ? "/run" : ""}`,
        {
          method:
            action === "toggle"
              ? "PATCH"
              : action === "delete"
                ? "DELETE"
                : "POST",
          ...(action !== "delete" && {
            body: action === "toggle" ? { enabled: !item.enabled } : {},
          }),
        },
      );
      await refresh();
      setDeleting(null);
      notify(
        action === "run"
          ? `任务已加入队列：${result.title}`
          : action === "delete"
            ? "定时计划已删除"
            : item.enabled
              ? "定时计划已停用"
              : "定时计划已启用",
      );
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <PageTitle
        title="定时计划"
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus size={18} />
            新建计划
          </Button>
        }
      />
      <section className="panel">
        {data!.schedules.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>来源 / 目录</th>
                  <th>更新间隔</th>
                  <th>下次检查</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data!.schedules.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.site}</strong>
                      <a
                        className="row-subtitle truncate"
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {item.url}
                      </a>
                      {item.error && (
                        <small className="text-danger">{item.error}</small>
                      )}
                      {item.lastTaskId && (
                        <Link
                          className="text-link small-link"
                          to={`/tasks/${item.lastTaskId}`}
                        >
                          上次任务 <ArrowUpRight size={13} />
                        </Link>
                      )}
                    </td>
                    <td>每 {item.intervalMinutes} 分钟</td>
                    <td className="date-cell">
                      {item.enabled ? date(item.nextRunAt) : "—"}
                    </td>
                    <td>
                      <span
                        className={`tag ${item.enabled ? "tag-success" : ""}`}
                      >
                        {item.enabled ? "已启用" : "已停用"}
                      </span>
                    </td>
                    <td>
                      <div className="button-group">
                        <Button
                          kind="ghost"
                          disabled={busy === item.id}
                          onClick={() => void change(item, "run")}
                        >
                          <Play size={15} />
                          立即检查
                        </Button>
                        <button
                          className="icon-button"
                          disabled={busy === item.id}
                          aria-label={item.enabled ? "停用计划" : "启用计划"}
                          onClick={() => void change(item, "toggle")}
                        >
                          {item.enabled ? (
                            <Pause size={17} />
                          ) : (
                            <Play size={17} />
                          )}
                        </button>
                        <button
                          className="icon-button"
                          aria-label="删除计划"
                          disabled={busy === item.id}
                          onClick={() => setDeleting(item)}
                        >
                          <Trash2 size={17} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="还没有定时计划"
            description="为书籍安排检查间隔，自动采集新增和缺失章节。"
            action={
              <Button kind="secondary" onClick={() => setCreating(true)}>
                <Plus size={16} />
                创建第一个计划
              </Button>
            }
          />
        )}
      </section>
      {creating && <ScheduleForm onClose={() => setCreating(false)} />}
      {deleting && (
        <Dialog
          title="删除这个计划？"
          subtitle="已有采集任务和书籍将继续保留。"
          onClose={() => setDeleting(null)}
        >
          <div className="dialog-footer">
            <Button kind="secondary" onClick={() => setDeleting(null)}>
              保留计划
            </Button>
            <Button
              kind="danger"
              disabled={!!busy}
              onClick={() => void change(deleting, "delete")}
            >
              确认删除
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function ScheduleForm({ onClose }: { onClose: () => void }) {
  const { data, refresh, notify } = useApp();
  const [site, setSite] = useState(data!.sites[0]?.name || "");
  const [url, setUrl] = useState("");
  const [interval, setInterval] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/schedules", {
        method: "POST",
        body: { site, url, intervalMinutes: interval },
      });
      await refresh();
      notify("计划已创建，将在下个检查时间自动执行");
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="新建定时计划"
      subtitle="服务运行时按计划检查更新，关闭后暂停调度。"
      onClose={onClose}
    >
      <form className="form-body" onSubmit={(event) => void submit(event)}>
        <label>
          来源站点
          <select
            value={site}
            onChange={(event) => setSite(event.target.value)}
          >
            {data!.sites.map((item) => (
              <option key={item.name}>{item.name}</option>
            ))}
          </select>
        </label>
        <label>
          书籍目录地址
          <input
            type="url"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/book/"
          />
        </label>
        <label>
          检查间隔（分钟）
          <input
            type="number"
            required
            min={5}
            max={43200}
            value={interval}
            onChange={(event) => setInterval(Number(event.target.value))}
          />
          <span className="field-hint">最少 5 分钟；推荐 60 分钟或更长。</span>
        </label>
        <FormError message={error} />
        <div className="dialog-footer">
          <Button type="button" kind="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={busy || !site}>
            {busy ? "正在创建…" : "创建计划"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function Exports() {
  const { data } = useApp();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageTitle
        title="导出中心"
        action={
          <Button
            disabled={!data!.books.length}
            onClick={() => setCreating(true)}
          >
            <Plus size={18} />
            新建导出
          </Button>
        }
      />
      <section className="panel">
        <div className="panel-heading">
          <h2>导出记录</h2>
          <span className="muted">最近 100 次</span>
        </div>
        {data!.exports.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>文件名称</th>
                  <th>格式</th>
                  <th>状态</th>
                  <th>生成时间</th>
                  <th>下载</th>
                </tr>
              </thead>
              <tbody>
                {data!.exports.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.filename}</strong>
                      {item.error && (
                        <small className="row-subtitle text-danger">
                          {item.error}
                        </small>
                      )}
                      {item.missing > 0 && (
                        <small className="row-subtitle text-danger">
                          缺少 {item.missing} 章，文件中已标注
                        </small>
                      )}
                    </td>
                    <td>
                      <span className="tag">{item.format.toUpperCase()}</span>
                    </td>
                    <td>
                      <Status status={item.status} />
                    </td>
                    <td className="date-cell">{date(item.createdAt)}</td>
                    <td>
                      {item.status === "completed" ? (
                        <a
                          className="button button-secondary"
                          href={`/api/exports/${item.id}/download`}
                          download
                        >
                          <Download size={15} />
                          下载
                        </a>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="还没有导出记录"
            description={
              data!.books.length
                ? "选择书籍，生成有序的 TXT 或 JSON 文件。"
                : "先添加一本书，完成采集后即可导出。"
            }
            action={
              data!.books.length ? (
                <Button kind="secondary" onClick={() => setCreating(true)}>
                  创建导出
                </Button>
              ) : (
                <Link className="button button-secondary" to="/books">
                  前往书库 <ArrowUpRight size={16} />
                </Link>
              )
            }
          />
        )}
      </section>
      {creating && <ExportForm onClose={() => setCreating(false)} />}
    </>
  );
}

function ExportForm({ onClose }: { onClose: () => void }) {
  const { data, refresh, notify } = useApp();
  const [bookId, setBookId] = useState(data!.books[0]?.id || "");
  const [format, setFormat] = useState("txt");
  const [allowPartial, setAllowPartial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api<ExportRecord>("/exports", {
        method: "POST",
        body: { bookId, format, allowPartial },
      });
      await refresh();
      notify("文件已生成，可以下载了");
      onClose();
    } catch (err) {
      setError((err as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="导出书籍"
      subtitle="文件按当前目录顺序生成，保留章节标题。"
      onClose={onClose}
    >
      <form className="form-body" onSubmit={(event) => void submit(event)}>
        <label>
          选择书籍
          <select
            value={bookId}
            onChange={(event) => setBookId(event.target.value)}
          >
            {data!.books.map((book) => (
              <option key={book.id} value={book.id}>
                {book.title}（{book.downloaded}/{book.total} 章）
              </option>
            ))}
          </select>
        </label>
        <label>
          文件格式
          <select
            value={format}
            onChange={(event) => setFormat(event.target.value)}
          >
            <option value="txt">TXT · 纯文本阅读</option>
            <option value="json">JSON · 结构化章节数据</option>
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={allowPartial}
            onChange={(event) => setAllowPartial(event.target.checked)}
          />
          <span>
            允许导出缺章版本
            <small>默认在缺章时停止导出，勾选后在文件中标注缺章。</small>
          </span>
        </label>
        <FormError message={error} />
        <div className="dialog-footer">
          <Button type="button" kind="secondary" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" disabled={busy || !bookId}>
            <Download size={16} />
            {busy ? "正在生成…" : "生成文件"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
