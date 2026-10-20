import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import {
  BookOpen,
  LayoutDashboard,
  ListTodo,
  Globe2,
  CalendarClock,
  Download,
  ArrowUpRight,
  Menu,
  X,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { useApp } from "./lib/context.js";
import { Button } from "./components/ui.js";
import { NewTask } from "./components/NewTask.js";
import { Overview, Books, BookDetail } from "./pages/Library.js";
import { Tasks, TaskDetailPage } from "./pages/Tasks.js";
import { Sites, Schedules, Exports } from "./pages/Settings.js";

const links = [
  { path: "/", label: "工作概览", icon: LayoutDashboard },
  { path: "/books", label: "我的书库", icon: BookOpen },
  { path: "/tasks", label: "采集任务", icon: ListTodo },
  { path: "/sites", label: "站点管理", icon: Globe2 },
  { path: "/schedules", label: "定时计划", icon: CalendarClock },
  { path: "/exports", label: "导出中心", icon: Download },
];

export function App() {
  const { data, connectionError, refresh, taskDraft } = useApp();
  const [mobile, setMobile] = useState(false);
  const location = useLocation();
  const current = links.find((link) =>
    link.path === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(link.path),
  );
  const worker = data?.worker;
  const workerLabel = worker
    ? {
        ready: "采集服务就绪",
        busy: "采集服务运行中",
        starting: "采集服务启动中",
        blocked: "等待采集进程释放",
        stopped: "采集服务已停止",
      }[worker.status]
    : "正在连接服务";
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="sidebar-scrim"
          aria-label="关闭导航"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "sidebar-open" : ""}`}>
        <NavLink to="/" className="brand" onClick={() => setMobile(false)}>
          <span className="brand-icon">
            <BookOpen size={25} />
          </span>
          <span>拾页</span>
        </NavLink>
        <nav>
          {links.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/"}
              onClick={() => setMobile(false)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {path === "/tasks" && !!data?.stats.queued && (
                <b>{data.stats.queued}</b>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span
            className={`service-dot ${worker?.status === "blocked" || worker?.status === "stopped" ? "dot-warning" : ""}`}
          />
          <div>{workerLabel}</div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="打开导航"
              onClick={() => setMobile(true)}
            >
              {mobile ? <X size={20} /> : <Menu size={20} />}
            </button>
            <strong>{current?.label || "页面"}</strong>
          </div>
        </header>
        <main>
          {connectionError && (
            <div className="notice notice-error">
              <span>连接服务失败：{connectionError}</span>
              <Button kind="ghost" onClick={() => void refresh()}>
                <RefreshCw size={16} />
                重新连接
              </Button>
            </div>
          )}
          {worker?.status === "blocked" && (
            <div className="notice">
              {worker.error ||
                "另一个采集进程正在运行。队列将在进程退出后自动继续。"}
            </div>
          )}
          {!data ? (
            <div className="loading-screen">
              <span className="spinner" />
              <p>正在打开工作空间…</p>
            </div>
          ) : (
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/books" element={<Books />} />
              <Route path="/books/:id" element={<BookDetail />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/tasks/:id" element={<TaskDetailPage />} />
              <Route path="/sites" element={<Sites />} />
              <Route path="/schedules" element={<Schedules />} />
              <Route path="/exports" element={<Exports />} />
              <Route
                path="*"
                element={
                  <div className="empty">
                    <h1>页面不存在</h1>
                    <NavLink to="/">
                      返回工作概览 <ArrowUpRight size={16} />
                    </NavLink>
                  </div>
                }
              />
            </Routes>
          )}
        </main>
      </div>
      {data && taskDraft && <NewTask />}
    </div>
  );
}
