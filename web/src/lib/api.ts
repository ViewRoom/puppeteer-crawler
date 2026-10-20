export async function api<T>(
  path: string,
  options?: { method?: string; body?: unknown; signal?: AbortSignal },
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: options?.method || "GET",
    headers:
      options?.body !== undefined
        ? { "Content-Type": "application/json" }
        : undefined,
    body:
      options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options?.signal,
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

export function date(value: string | number | null | undefined): string {
  if (value == null || value === "") return "—";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "—";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${time.getFullYear()}/${pad(time.getMonth() + 1)}/${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`;
}
export const number = (value: number) => value.toLocaleString("zh-CN");
