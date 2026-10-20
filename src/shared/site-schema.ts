import { z } from "zod";

const httpUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "只支持 HTTP(S) URL");
const pagination = z
  .object({
    selector: z.string().min(1),
    text: z.string().min(1).optional(),
    maxPages: z.number().int().positive().max(100_000).default(1000),
  })
  .strict();

export const siteSchema = z
  .object({
    name: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    transport: z.enum(["browser", "http"]).default("browser"),
    baseUrls: z.array(httpUrl).default([]),
    selectors: z
      .object({
        novelTitle: z.string().min(1).optional(),
        chapterList: z.string().min(1),
        chapterContent: z.string().min(1),
        remove: z.array(z.string().min(1)).default([]),
      })
      .strict(),
    pagination: z
      .object({
        catalog: pagination.optional(),
        content: pagination.optional(),
      })
      .strict()
      .default({}),
    request: z
      .object({
        timeoutMs: z.number().int().positive().max(300_000).default(30_000),
        retries: z.number().int().min(0).max(10).default(3),
        retryDelayMs: z.number().int().min(0).max(60_000).default(1000),
        intervalMs: z.number().int().min(0).max(60_000).default(500),
      })
      .strict()
      .prefault({}),
    concurrency: z.number().int().positive().max(20).default(2),
  })
  .strict();

export type SiteConfig = z.infer<typeof siteSchema>;
