import { resolve } from "node:path";
import { createApp } from "./app.js";

const port = Number(process.env.PORT || 7777);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT 必须是 1–65535 的整数");
const { app } = await createApp({
  dataDir: resolve(process.env.CRAWLER_DATA_DIR || "./data"),
});
const close = () => {
  void app.close().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
try {
  await app.listen({ host: process.env.HOST || "127.0.0.1", port });
  console.log(`拾页 · 小说采集管理台 http://127.0.0.1:${port}`);
} catch (error) {
  console.error(error);
  await app.close();
  process.exitCode = 1;
}
