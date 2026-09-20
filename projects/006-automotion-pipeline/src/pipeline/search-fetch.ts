// src/pipeline/search-fetch.ts —— 预检索（文案时效修复第 2 层，2026-08-07）
// 给流水线 DeepSeek 配「外挂搜索工具」：Tavily API 直调（免费 1000 次/月，无需信用卡）。
// 模型无内置联网（联网能力在工具层），搜索结果是「喂给模型的情报」而非模型自主行为——
// 确定性步骤用确定性代码（agentic 调研为观察项，暂不实施）。
// 环境变量：TAVILY_API_KEY；搜索失败由调用方兜底（增强非致命）。
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  publishedDate: string | null;
  score: number | null; // Tavily 相关度 0-1；null = 未返回
}

/** 调 Tavily /search：topic=news 只取新闻类结果（时效性优先），返回带发布日期与相关度的结果 */
export async function tavilySearch(
  query: string,
  apiKey: string,
  maxResults = 10,
): Promise<SearchResult[]> {
  const resp = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      topic: 'news',
      include_answer: false,
      include_raw_content: false,
      search_depth: 'basic',
    }),
    signal: AbortSignal.timeout(15000), // 防 API 抽风挂住（免费服务偶发）
  });
  if (!resp.ok) {
    throw new Error(`Tavily ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const json = (await resp.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      published_date?: string;
      score?: number;
    }>;
  };
  return (json.results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    content: r.content ?? '',
    publishedDate: r.published_date ?? null,
    score: typeof r.score === 'number' ? r.score : null,
  }));
}

/**
 * 博查 Web Search（2026-08-07 接入，中文专长）：Bing 兼容结构 data.webPages.value，
 * freshness 按时间范围筛选（时效性）；无相关度分数（score=null，过滤时放行）。
 */
export async function bochaSearch(
  query: string,
  apiKey: string,
  count = 10,
): Promise<SearchResult[]> {
  const resp = await fetch('https://api.bocha.cn/v1/web-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, freshness: 'noLimit', summary: true, count }),
    signal: AbortSignal.timeout(15000), // 防 API 抽风挂住（免费服务偶发）
  });
  if (!resp.ok) {
    throw new Error(`Bocha ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const json = (await resp.json()) as {
    data?: { webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string; summary?: string; datePublished?: string }> } };
  };
  const pages = json.data?.webPages?.value ?? [];
  return pages.map((p) => ({
    title: p.name ?? '',
    url: p.url ?? '',
    content: p.summary ?? p.snippet ?? '',
    publishedDate: p.datePublished ?? null,
    score: null,
  }));
}

/** 统一入口（双提供者）：SEARCH_PROVIDER 选默认（bocha 中文专长 / tavily 英文兜底）。
 * 2026-08-07 策略：主提供者失败/空 → **先重试**（免费 API 偶发抽风通常瞬时；回退提供者
 * 中文质量差——实测 MMA 拳击乱入——重试主提供者比回退更划算），重试耗尽才回退；
 * 无 key 抛错（调用方警告兜底） */
export async function runSearch(query: string, primaryRetries = 2): Promise<SearchResult[]> {
  const provider = process.env.SEARCH_PROVIDER ?? 'bocha';
  const isBocha = provider !== 'tavily';
  const primaryKey = isBocha ? process.env.BOCHA_API_KEY : process.env.TAVILY_API_KEY;
  const fallbackKey = isBocha ? process.env.TAVILY_API_KEY : process.env.BOCHA_API_KEY;
  const primaryFn = isBocha ? bochaSearch : tavilySearch;
  const fallbackFn = isBocha ? tavilySearch : bochaSearch;
  if (primaryKey) {
    for (let attempt = 1; attempt <= primaryRetries; attempt++) {
      try {
        const results = await primaryFn(query, primaryKey);
        if (results.length > 0) return results;
        console.warn(`[search] ${provider} 第 ${attempt} 次返回空，${attempt < primaryRetries ? '重试中' : '重试耗尽，回退'}`);
      } catch (e) {
        console.warn(`[search] ${provider} 第 ${attempt} 次失败: ${e instanceof Error ? e.message : e}`);
      }
      if (attempt < primaryRetries) await new Promise((r) => setTimeout(r, 400));
    }
  }
  if (fallbackKey) {
    try {
      const results = await fallbackFn(query, fallbackKey);
      if (results.length > 0) return results;
      console.warn('[search] 回退提供者也返回空');
    } catch (e) {
      console.warn(`[search] 回退失败: ${e instanceof Error ? e.message : e}`);
    }
  }
  throw new Error('未配置搜索 API key（BOCHA_API_KEY / TAVILY_API_KEY）或所有提供者均失败');
}

/**
 * Reranker 语义重排（2026-08-07）：硅基流动 Qwen3-Reranker-8B（质量榜第一，$0.04/M tokens
 * ≈ 每轮一厘钱）。documents = 标题+摘要；响应 results[] 带 relevance_score（0-1）。
 */
export async function rerankWithSiliconflow(
  query: string,
  documents: string[],
  apiKey: string,
  model = 'Qwen/Qwen3-Reranker-8B',
  instruction?: string,
): Promise<Array<{ index: number; relevanceScore: number }>> {
  // 注意域名：国内版 API 是 api.siliconflow.cn（.com 是国际版，key 不通用——2026-08-07 实测 401）
  const body: Record<string, unknown> = { model, query, documents, top_n: documents.length };
  // Qwen3-Reranker 指令跟随：自定义排序标准（2026-08-07，如时效优先/主题强化）
  if (instruction) body.instruction = instruction;
  const resp = await fetch('https://api.siliconflow.cn/v1/rerank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    throw new Error(`SiliconFlow ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const json = (await resp.json()) as {
    results?: Array<{ index?: number; relevance_score?: number }>;
  };
  return (json.results ?? []).map((r) => ({ index: r.index ?? -1, relevanceScore: r.relevance_score ?? 0 }));
}

/** 标题相似去重（2026-08-07：同一内容不同站重复——早报在头条/网易等多个站出现）：
 * 归一化标题（去标点空白）取前 12 字符做键，保留首次出现（rerank 排序后 = 分数高的那份） */
export function dedupeByTitle(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    const key = r.title.replace(/[^\w一-龥]/g, '').slice(0, 12);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** 按 rerank 分数重排结果（不丢弃——先排序，阈值策略待分数分布实测后定）+ 标题相似去重 */
export async function rerankResults(
  query: string,
  results: SearchResult[],
  apiKey: string,
  instruction?: string,
): Promise<SearchResult[]> {
  const documents = results.map((r) => `${r.title}。${r.content.slice(0, 300)}`);
  const reranked = await rerankWithSiliconflow(query, documents, apiKey, 'Qwen/Qwen3-Reranker-8B', instruction);
  const scoreByIndex = new Map(reranked.map((r) => [r.index, r.relevanceScore]));
  const sorted = [...results].sort((a, b) => {
    const sa = scoreByIndex.get(results.indexOf(a)) ?? 0;
    const sb = scoreByIndex.get(results.indexOf(b)) ?? 0;
    return sb - sa;
  });
  return dedupeByTitle(sorted);
}

/**
 * 过滤（2026-08-07 优化，实测长中文 query 结果飘：MMA 新闻乱入）：
 * 相关度 score < minScore 丢弃；发布日期早于 maxAgeDays 丢弃（无日期保留——部分源不返回）；
 * 同 URL 去重（去 query 参数）；按 score 倒序取前 maxKeep。
 */
export function filterSearchResults(
  results: SearchResult[],
  maxKeep = 6,
  minScore = 0.35,
  maxAgeDays = 90,
): SearchResult[] {
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  const ok = results.filter((r) => {
    if (r.score !== null && r.score < minScore) return false;
    if (r.publishedDate) {
      const t = Date.parse(r.publishedDate);
      if (!Number.isNaN(t) && t < cutoff) return false;
    }
    return true;
  });
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];
  for (const r of [...ok].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))) {
    const key = r.url.split('?')[0];
    if (key === undefined) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  return deduped.slice(0, maxKeep);
}

/** 注入 prompt 的格式化文本：按发布日期倒序（无日期的垫底），每条带标题/日期/URL/摘要 */
export function formatSearchResults(results: SearchResult[]): string {
  const sorted = [...results].sort((a, b) => {
    if (!a.publishedDate) return 1;
    if (!b.publishedDate) return -1;
    return b.publishedDate.localeCompare(a.publishedDate);
  });
  return sorted
    .map(
      (r, i) =>
        `${i + 1}. [${r.publishedDate ?? '无日期'}] ${r.title}\n   ${r.url}\n   ${r.content.slice(0, 200)}`,
    )
    .join('\n');
}

/** 搜索结果落盘 research.json（可追溯：搜了什么、结果是什么） */
export function persistResearch(runDir: string, query: string, results: SearchResult[]): void {
  writeFileSync(
    join(runDir, 'research.json'),
    JSON.stringify({ query, fetchedAt: new Date().toISOString(), results }, null, 2),
    'utf8',
  );
}
