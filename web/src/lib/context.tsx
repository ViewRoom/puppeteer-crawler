import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Dashboard } from "../../../src/shared/contracts.js";
import { api } from "./api.js";

interface AppContext {
  data: Dashboard | null;
  connectionError: string;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  openTask: (site?: string, url?: string) => void;
  taskDraft: { site?: string; url?: string } | null;
  closeTask: () => void;
}
const Context = createContext<AppContext | null>(null);
export function useApp(): AppContext {
  const value = useContext(Context);
  if (!value) throw new Error("缺少应用上下文");
  return value;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const [taskDraft, setTaskDraft] = useState<AppContext["taskDraft"]>(null);
  const loading = useRef(false);
  const notify = useCallback(
    (message: string, error = false) => setToast({ message, error }),
    [],
  );
  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      setData(await api<Dashboard>("/state"));
      setConnectionError("");
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : "连接失败");
    } finally {
      loading.current = false;
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 8000 : 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <Context.Provider
      value={{
        data,
        connectionError,
        refresh,
        notify,
        taskDraft,
        openTask: (site, url) => setTaskDraft({ site, url }),
        closeTask: () => setTaskDraft(null),
      }}
    >
      {children}
      {toast && (
        <div
          className={`toast ${toast.error ? "toast-error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.message}
          <button aria-label="关闭提示" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
