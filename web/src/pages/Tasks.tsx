import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Plus,
  ArrowUpRight,
  ArrowLeft,
  Pause,
  Play,
  RotateCcw,
  X,
  RefreshCw,
} from "lucide-react";
import type { TaskSummary } from "../../../src/domain/models.js";
import type { TaskDetail } from "../../../src/shared/contracts.js";
import { useApp } from "../lib/context.js";
import { api, date, number } from "../lib/api.js";
import { useResource } from "../lib/useResource.js";
import {
  Button,
  Dialog,
  Empty,
  FormError,
  PageTitle,
  Pager,
  Progress,
  Status,
} from "../components/ui.js";

export function TaskTable({
  tasks,
  compact = false,
}: {
  tasks: TaskSummary[];
  compact?: boolean;
}) {
  const { openTask } = useApp();
  const navigate = useNavigate();
  if (!tasks.length)
    return (
      <Empty
        title="还没有采集任务"
        action={
          <Button kind="secondary" onClick={() => openTask()}>
            <Plus size={16} />
            新建任务
          </Button>
        }
      />
    );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>任务 / 书名</th>
            <th>状态</th>
            <th>采集进度</th>
            {!compact && <th>失败章节</th>}
            <th>创建时间</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr
              key={task.id}
              className="task-row"
              onClick={(event) => {
                if (!(event.target as HTMLElement).closest("a")) {
                  void navigate(`/tasks/${task.id}`);
                }
              }}
            >
              <td>
                <Link className="row-title" to={`/tasks/${task.id}`}>
                  {task.title}
                </Link>
              </td>
              <td>
                <Status status={task.status} control={task.control} />
              </td>
              <td>
                <Progress task={task} />
                <small className="row-subtitle">
                  {number(task.succeeded + task.skipped)} / {number(task.total)}{" "}
                  章
                </small>
              </td>
              {!compact && (
                <td>
                  <span className={task.failed ? "text-danger" : "muted"}>
                    {task.failed}
                  </span>
                </td>
              )}
              <td className="date-cell">{date(task.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Tasks() {
  const { data, openTask } = useApp();
  const [filter, setFilter] = useState("all");
  const filters = [
    { key: "all", label: "全部任务" },
    { key: "active", label: "进行中" },
    { key: "paused", label: "已暂停" },
    { key: "failed", label: "待处理" },
    { key: "completed", label: "已完成" },
  ];
  const tasks = data!.tasks.filter(
    (task) =>
      filter === "all" ||
      (filter === "active"
        ? ["running", "queued", "pending"].includes(task.status)
        : filter === "failed"
          ? ["failed", "interrupted"].includes(task.status)
          : task.status === filter),
  );
  return (
    <>
      <PageTitle
        title="采集任务"
        action={
          <Button onClick={() => openTask()}>
            <Plus size={18} />
            新建采集任务
          </Button>
        }
      />
      <section className="panel">
        <div className="tabs">
          {filters.map((item) => (
            <button
              key={item.key}
              className={filter === item.key ? "active" : ""}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
              {item.key === "all" && <span>{data!.tasks.length}</span>}
            </button>
          ))}
        </div>
        <TaskTable tasks={tasks} />
      </section>
      <p className="footnote">最近 100 个任务</p>
    </>
  );
}

export function TaskDetailPage() {
  const { id } = useParams();
  const { refresh, notify } = useApp();
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const [level, setLevel] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const result = useResource<TaskDetail>(
    `/tasks/${id}?offset=${offset}&limit=50&status=${status}&level=${level}`,
    true,
  );
  async function action(name: string) {
    setBusy(true);
    try {
      await api(`/tasks/${id}/${name}`, { method: "POST", body: {} });
      await refresh();
      result.reload();
      notify(
        {
          pause: "已请求暂停，进度将自动保存",
          resume: "任务已重新加入队列",
          retry: "失败章节已加入补采队列",
          cancel: "已请求取消任务",
        }[name] || "操作成功",
      );
      setConfirmCancel(false);
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const detail = result.data;
  if (!detail)
    return (
      <>
        <Link className="back-link" to="/tasks">
          <ArrowLeft size={16} />
          返回任务列表
        </Link>
        <FormError message={result.error} />
        <div className="loading-screen">正在加载任务…</div>
      </>
    );
  const { task, items, events } = detail;
  const active = ["queued", "pending", "running"].includes(task.status);
  const resumable = ["paused", "interrupted", "failed"].includes(task.status);
  return (
    <>
      <Link className="back-link" to="/tasks">
        <ArrowLeft size={16} />
        返回任务列表
      </Link>
      <PageTitle
        title={task.title}
        description={`创建于 ${date(task.createdAt)}`}
        action={
          <div className="button-group">
            {active && (
              <Button
                kind="secondary"
                disabled={busy || !!task.control}
                onClick={() => void action("pause")}
              >
                <Pause size={16} />
                暂停
              </Button>
            )}
            {resumable && (
              <Button disabled={busy} onClick={() => void action("resume")}>
                <Play size={16} />
                继续采集
              </Button>
            )}
            {resumable && !!task.failed && (
              <Button
                kind="secondary"
                disabled={busy}
                onClick={() => void action("retry")}
              >
                <RotateCcw size={16} />
                补采失败章节
              </Button>
            )}
            {!["completed", "cancelled"].includes(task.status) && (
              <Button
                kind="ghost"
                disabled={busy || !!task.control}
                onClick={() => setConfirmCancel(true)}
              >
                <X size={16} />
                取消任务
              </Button>
            )}
          </div>
        }
      />
      <FormError message={result.error} />
      <section className="panel task-summary">
        <div className="task-summary-top">
          <Status status={task.status} control={task.control} />
          <Link to={`/books/${task.bookId}`} className="text-link">
            查看书籍 <ArrowUpRight size={16} />
          </Link>
        </div>
        <Progress task={task} />
        <div className="task-numbers">
          {[
            { label: "目录章节", value: task.total },
            { label: "采集成功", value: task.succeeded },
            { label: "已有跳过", value: task.skipped },
            { label: "采集失败", value: task.failed },
            { label: "等待处理", value: task.pending },
          ].map((item) => (
            <div key={item.label}>
              <strong>{number(item.value)}</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
        {task.error && <div className="notice notice-error">{task.error}</div>}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>章节明细</h2>
          <select
            aria-label="筛选章节状态"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setOffset(0);
            }}
          >
            {[
              ["", "全部状态"],
              ["failed", "采集失败"],
              ["pending", "待采集"],
              ["running", "采集中"],
              ["succeeded", "已采集"],
              ["skipped", "已跳过"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>章节标题</th>
                <th>状态</th>
                <th>尝试次数</th>
                <th>错误信息</th>
              </tr>
            </thead>
            <tbody>
              {items.items.map((item) => (
                <tr key={item.chapterId}>
                  <td>{item.title}</td>
                  <td>
                    <Status status={item.status} />
                  </td>
                  <td>{item.attempts}</td>
                  <td className="error-cell">{item.error || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!items.total && (
          <div className="small-empty">
            {task.total ? "没有符合条件的章节" : "等待获取章节目录"}
          </div>
        )}
        <Pager
          offset={offset}
          total={items.total}
          limit={50}
          onChange={setOffset}
        />
      </section>
      <details className="panel log-panel">
        <summary>
          运行日志 <span>最近 100 条</span>
        </summary>
        <div className="panel-heading">
          <span className="muted">日志等级</span>
          <select
            aria-label="筛选日志等级"
            value={level}
            onChange={(event) => setLevel(event.target.value)}
          >
            <option value="">全部等级</option>
            <option value="info">普通信息</option>
            <option value="warn">警告</option>
            <option value="error">错误</option>
          </select>
        </div>
        {events.length ? (
          <div className="event-list">
            {events.map((event) => (
              <details key={event.id}>
                <summary>
                  <time>{date(event.createdAt)}</time>
                  <span className={`log-level log-${event.level}`}>
                    {event.level.toUpperCase()}
                  </span>
                  <span>{event.message}</span>
                </summary>
                <pre>{JSON.stringify(JSON.parse(event.data), null, 2)}</pre>
              </details>
            ))}
          </div>
        ) : (
          <div className="small-empty">
            <RefreshCw size={17} />
            暂无日志，任务启动后会自动显示
          </div>
        )}
      </details>
      {confirmCancel && (
        <Dialog
          title="取消这个任务？"
          subtitle="已采集章节会保留，取消后可为这本书创建新的任务。"
          onClose={() => setConfirmCancel(false)}
        >
          <div className="dialog-footer">
            <Button kind="secondary" onClick={() => setConfirmCancel(false)}>
              继续保留
            </Button>
            <Button
              kind="danger"
              disabled={busy}
              onClick={() => void action("cancel")}
            >
              确认取消任务
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
