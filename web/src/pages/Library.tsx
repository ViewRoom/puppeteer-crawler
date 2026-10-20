import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Plus,
  ArrowUpRight,
  BookOpen,
  Search,
  ArrowLeft,
  Download,
  ExternalLink,
} from "lucide-react";
import { useApp } from "../lib/context.js";
import { date, number, api } from "../lib/api.js";
import { useResource } from "../lib/useResource.js";
import {
  Button,
  Dialog,
  Empty,
  FormError,
  PageTitle,
  Pager,
  Status,
} from "../components/ui.js";
import { TaskTable } from "./Tasks.js";
import type { Chapter } from "../../../src/domain/models.js";
import type {
  ChapterSummary,
  PageResult,
} from "../../../src/shared/contracts.js";

export function Overview() {
  const { data: state, openTask } = useApp();
  const data = state!;
  const stats = [
    { title: "书籍", value: data.stats.books, unit: "本" },
    { title: "已采集章节", value: data.stats.downloaded, unit: "章" },
    {
      title: "进行中任务",
      value: data.stats.running + data.stats.queued,
      unit: "个",
    },
  ];
  return (
    <>
      <PageTitle
        title="工作概览"
        action={
          <Button onClick={() => openTask()}>
            <Plus size={18} />
            新建采集任务
          </Button>
        }
      />
      <section className="stats-grid" aria-label="采集统计">
        {stats.map(({ title, value, unit }) => (
          <article className="stat-card" key={title}>
            <div className="stat-top">{title}</div>
            <div className="stat-value">
              {number(value)}
              <small>{unit}</small>
            </div>
          </article>
        ))}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>最近任务</h2>
          <Link className="text-link" to="/tasks">
            全部任务 <ArrowUpRight size={16} />
          </Link>
        </div>
        <TaskTable tasks={data.tasks.slice(0, 5)} compact />
      </section>
    </>
  );
}

export function Books() {
  const { data, openTask } = useApp();
  const [search, setSearch] = useState("");
  const books = data!.books.filter((book) =>
    `${book.title} ${book.site}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageTitle
        title="我的书库"
        action={
          <Button onClick={() => openTask()}>
            <Plus size={18} />
            添加书籍
          </Button>
        }
      />
      <div className="toolbar">
        <span className="count-label">
          全部书籍 <b>{data!.books.length}</b>
        </span>
        <div className="search-input">
          <Search size={17} />
          <input
            aria-label="搜索书籍"
            placeholder="搜索书名或站点…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {books.length ? (
        <div className="book-grid">
          {books.map((book) => (
            <Link className="book-card" to={`/books/${book.id}`} key={book.id}>
              <span className="book-symbol">
                <BookOpen size={25} strokeWidth={1.5} />
              </span>
              <div className="book-info">
                <h2>{book.title}</h2>
                <span className="book-source">{book.site}</span>
                <div>
                  <span>
                    {number(book.downloaded)} / {number(book.total)} 章
                  </span>
                </div>
                <div className="progress-track">
                  <span
                    style={{
                      width: `${book.total ? (book.downloaded / book.total) * 100 : 0}%`,
                    }}
                  />
                </div>
                <p>更新于 {date(book.updatedAt)}</p>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="panel">
          <Empty
            title={search ? "没有匹配的书籍" : "还没有收藏书籍"}
            description={
              search
                ? "试试其他书名或站点名称。"
                : "创建采集任务后，书籍和章节会自动出现在这里。"
            }
            action={
              !search && (
                <Button onClick={() => openTask()}>添加第一本书</Button>
              )
            }
          />
        </div>
      )}
    </>
  );
}

export function BookDetail() {
  const { id } = useParams();
  const { data, openTask, notify, refresh } = useApp();
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [busy, setBusy] = useState(false);
  const book = data!.books.find((item) => item.id === id);
  const result = useResource<PageResult<ChapterSummary>>(
    `/books/${id}/chapters?offset=${offset}&limit=50&search=${encodeURIComponent(search)}`,
    true,
  );
  async function read(chapterId: string) {
    try {
      setChapter(await api<Chapter>(`/books/${id}/chapters/${chapterId}`));
    } catch (error) {
      notify((error as Error).message, true);
    }
  }
  async function exportTxt() {
    setBusy(true);
    try {
      await api("/exports", {
        method: "POST",
        body: { bookId: id, format: "txt" },
      });
      await refresh();
      notify("TXT 已生成，可在导出中心下载");
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  if (!book)
    return (
      <Empty title="找不到这本书" action={<Link to="/books">返回书库</Link>} />
    );
  return (
    <>
      <Link className="back-link" to="/books">
        <ArrowLeft size={16} />
        返回书库
      </Link>
      <PageTitle
        title={book.title}
        description={`已收集 ${number(book.downloaded)} / ${number(book.total)} 章 · 更新于 ${date(book.updatedAt)}`}
        action={
          <div className="button-group">
            <Button
              kind="secondary"
              disabled={busy}
              onClick={() => void exportTxt()}
            >
              <Download size={17} />
              导出 TXT
            </Button>
            <Button onClick={() => openTask(book.site, book.url)}>
              <Plus size={17} />
              检查更新
            </Button>
          </div>
        }
      />
      <section className="panel">
        <div className="panel-heading">
          <h2>
            章节目录 <small>{number(book.total)} 章</small>
          </h2>
          <a
            className="text-link"
            href={book.url}
            target="_blank"
            rel="noreferrer"
          >
            原始目录 <ExternalLink size={15} />
          </a>
        </div>
        <div className="toolbar panel-toolbar">
          <div className="search-input">
            <Search size={17} />
            <input
              aria-label="搜索章节"
              placeholder="搜索章节标题…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setOffset(0);
              }}
            />
          </div>
        </div>
        <FormError message={result.error} />
        <div className="chapter-list">
          {result.data?.items.map((item) => (
            <button
              key={item.id}
              disabled={!item.downloaded}
              onClick={() => void read(item.id)}
            >
              <span className="chapter-number">
                {String(item.position + 1).padStart(3, "0")}
              </span>
              <span>{item.title}</span>
              <Status status={item.downloaded ? "succeeded" : "pending"} />
            </button>
          ))}
        </div>
        {result.data && !result.data.total && (
          <Empty
            title="没有章节"
            description={
              search
                ? "没有找到符合条件的章节。"
                : "获取目录后，章节会出现在这里。"
            }
          />
        )}
        {result.data && (
          <Pager
            offset={offset}
            total={result.data.total}
            limit={50}
            onChange={setOffset}
          />
        )}
      </section>
      {chapter && (
        <Dialog
          title={chapter.title}
          subtitle={book.title}
          wide
          onClose={() => setChapter(null)}
        >
          <article className="reader">{chapter.content}</article>
        </Dialog>
      )}
    </>
  );
}
