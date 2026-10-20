import { useState, type FormEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { TaskSummary } from "../../../src/domain/models.js";
import { useApp } from "../lib/context.js";
import { api } from "../lib/api.js";
import { Button, Dialog, FormError } from "./ui.js";

export function NewTask() {
  const { data, taskDraft, closeTask, refresh, notify } = useApp();
  const sites = data?.sites || [];
  const initial =
    sites.find((site) => site.name === taskDraft?.site) || sites[0];
  const [site, setSite] = useState(initial?.name || "");
  const [url, setUrl] = useState(
    taskDraft?.url || initial?.config.baseUrls[0] || "",
  );
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const task = await api<TaskSummary>("/tasks", {
        method: "POST",
        body: { site, url, refresh: force },
      });
      await refresh();
      closeTask();
      notify("任务已加入队列，进度会自动保存");
      navigate(`/tasks/${task.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="新建采集任务" onClose={closeTask}>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        className="form-body"
      >
        <label>
          来源站点
          <select
            value={site}
            onChange={(event) => {
              setSite(event.target.value);
              setUrl(
                sites.find((item) => item.name === event.target.value)?.config
                  .baseUrls[0] || "",
              );
            }}
          >
            {sites.map((item) => (
              <option key={item.name}>{item.name}</option>
            ))}
          </select>
        </label>
        <label>
          章节目录地址
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            required
            placeholder="https://example.com/book/"
          />
          <span className="field-hint">
            请填写目录页，而非某一章的正文地址。
          </span>
        </label>
        <details className="advanced-options">
          <summary>高级选项</summary>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={force}
              onChange={(event) => setForce(event.target.checked)}
            />
            <span>
              重新采集已有章节
              <small>默认仅采集新增与缺失章节，节省等待时间。</small>
            </span>
          </label>
        </details>
        <FormError message={error} />
        <div className="dialog-footer">
          <Button type="button" kind="secondary" onClick={closeTask}>
            取消
          </Button>
          <Button type="submit" disabled={busy || !site}>
            {busy ? "正在创建…" : "开始采集"}
            <ArrowUpRight size={16} />
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
