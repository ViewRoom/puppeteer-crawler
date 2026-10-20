import { useEffect, useState } from "react";
import { api } from "./api.js";

export function useResource<T>(path: string, poll = false) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let stopped = false;
    let pending = false;
    const controller = new AbortController();
    setData(null);
    async function fetchData() {
      if (pending) return;
      pending = true;
      try {
        const result = await api<T>(path, { signal: controller.signal });
        if (!stopped) {
          setData(result);
          setError("");
        }
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        pending = false;
      }
    }
    void fetchData();
    const timer = poll ? setInterval(() => void fetchData(), 2000) : undefined;
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [path, poll, revision]);
  return { data, error, reload: () => setRevision((value) => value + 1) };
}
