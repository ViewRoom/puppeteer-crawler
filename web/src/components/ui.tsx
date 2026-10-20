import {
  useEffect,
  useRef,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { BookOpen, X, ChevronLeft, ChevronRight } from "lucide-react";
import type { TaskSummary } from "../../../src/domain/models.js";

export function Button({
  children,
  kind = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button className={`button button-${kind} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function Dialog({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "dialog-wide" : ""}`}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog-header">
        <div>
          <h2 id="dialog-title">{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <BookOpen size={29} strokeWidth={1.5} />
      </div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
const labels: Record<string, string> = {
  pending: "待启动",
  queued: "排队中",
  running: "采集中",
  paused: "已暂停",
  cancelled: "已取消",
  interrupted: "待恢复",
  completed: "已完成",
  failed: "失败",
  succeeded: "已采集",
  skipped: "已跳过",
};
export function Status({
  status,
  control,
}: {
  status: string;
  control?: TaskSummary["control"];
}) {
  return (
    <span className={`badge badge-${status}`}>
      <i />
      {control
        ? control === "pause"
          ? "正在暂停"
          : "正在取消"
        : labels[status] || status}
    </span>
  );
}
export function Progress({
  task,
}: {
  task: Pick<TaskSummary, "total" | "succeeded" | "skipped" | "status">;
}) {
  const done = task.succeeded + task.skipped;
  const percent = task.total ? Math.round((done / task.total) * 100) : 0;
  return (
    <div className="progress-cell">
      <div className="progress-track">
        <span
          style={{ width: `${percent}%` }}
          className={task.status === "failed" ? "progress-error" : ""}
        />
      </div>
      <span>{task.total ? `${percent}%` : "获取目录"}</span>
    </div>
  );
}
export function PageTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Pager({
  offset,
  total,
  limit,
  onChange,
}: {
  offset: number;
  total: number;
  limit: number;
  onChange: (offset: number) => void;
}) {
  return (
    <div className="pager">
      <span>
        共 {total.toLocaleString()} 条 · 第 {Math.floor(offset / limit) + 1} 页
      </span>
      <div>
        <button
          aria-label="上一页"
          className="icon-button"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          aria-label="下一页"
          className="icon-button"
          disabled={offset + limit >= total}
          onClick={() => onChange(offset + limit)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
export function FormError({ message }: { message: string }) {
  return message ? (
    <div className="form-error" role="alert">
      {message}
    </div>
  ) : null;
}
