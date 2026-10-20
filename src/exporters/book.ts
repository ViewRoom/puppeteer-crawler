import { mkdir, writeFile, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../infrastructure/storage/store.js";

export function safeFilename(title: string): string {
  const name = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  let result = "";
  for (const character of (name || "untitled").normalize("NFC")) {
    if (Buffer.byteLength(result + character) > 160) break;
    result += character;
  }
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)
    ? `_${result}`
    : result;
}

export async function exportBook(
  store: Store,
  bookId: string,
  options: {
    format: "txt" | "json";
    outputDir: string;
    output?: string;
    allowPartial?: boolean;
  },
): Promise<{ path: string; missing: number; chapters: number }> {
  const book = store.getBook(bookId);
  const chapters = store.chapters(bookId);
  if (!chapters.length) throw new Error("尚未获取完整目录，无法导出");
  const missing = chapters.filter((chapter) => chapter.content === null);
  if (missing.length && !options.allowPartial)
    throw new Error(
      `缺少 ${missing.length} 个章节，已保留现有文件。请先补采，或显式允许缺章导出`,
    );
  const content =
    options.format === "json"
      ? JSON.stringify(
          {
            book,
            incomplete: missing.length > 0,
            missing: missing.map(({ title, url }) => ({ title, url })),
            chapters,
          },
          null,
          2,
        ) + "\n"
      : `${book.title}\n${missing.length ? `\n【不完整导出：缺少 ${missing.length} 个章节】\n` : ""}\n` +
        chapters
          .map(
            (chapter) =>
              `${chapter.title}\n\n${chapter.content ?? "【本章尚未采集】"}\n`,
          )
          .join("\n");
  const target = resolve(
    options.output ||
      join(
        options.outputDir,
        `${safeFilename(book.title)}-${book.id.slice(0, 8)}.${options.format}`,
      ),
  );
  const temporary = `${target}.${randomUUID()}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return {
    path: target,
    missing: missing.length,
    chapters: chapters.length - missing.length,
  };
}
