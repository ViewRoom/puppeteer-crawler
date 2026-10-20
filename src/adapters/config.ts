import { readFile } from "node:fs/promises";
import { z } from "zod";

import { siteSchema, type SiteConfig } from "../shared/site-schema.js";
export { siteSchema, type SiteConfig } from "../shared/site-schema.js";

export function canonicalUrl(value: string, base?: string): string {
  const url = new URL(value, base);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`不支持的 URL 协议: ${url.protocol}`);
  }
  url.hash = "";
  return url.href;
}

export async function loadSites(
  customPath?: string,
  managed: SiteConfig[] = [],
): Promise<SiteConfig[]> {
  const { builtinSites } = await import("./sites.js");
  const sites = new Map(builtinSites.map((site) => [site.name, site]));
  for (const site of managed) sites.set(site.name, site);
  if (customPath) {
    const custom = await loadCustomSites(customPath);
    for (const site of custom) sites.set(site.name, site);
  }
  return [...sites.values()];
}

export async function loadCustomSites(path: string): Promise<SiteConfig[]> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  const sites = z
    .array(siteSchema)
    .min(1)
    .parse(Array.isArray(raw) ? raw : [raw]);
  if (new Set(sites.map((site) => site.name)).size !== sites.length) {
    throw new Error("自定义配置包含重复的站点名称");
  }
  return sites;
}
