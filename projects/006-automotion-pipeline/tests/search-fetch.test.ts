// tests/search-fetch.test.ts —— 预检索（Tavily/Bocha 双提供者 + Reranker）纯逻辑测试，不真调外部 API
import { describe, expect, it, vi, afterEach } from 'vitest';
import { bochaSearch, filterSearchResults, formatSearchResults, persistResearch, rerankResults, rerankWithSiliconflow, runSearch, tavilySearch, type SearchResult } from '../src/pipeline/search-fetch.js';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

afterEach(() => {
  vi.unstubAllGlobals();
});

const r = (title: string, publishedDate: string | null, score: number | null, url = 'https://x'): SearchResult =>
  ({ title, url, content: '内容', publishedDate, score });

describe('formatSearchResults', () => {
  const results: SearchResult[] = [
    r('旧闻', '2026-07-20', 0.6),
    r('最新', '2026-08-05', 0.9),
    r('无日期', null, 0.5),
  ];
  it('按发布日期倒序，无日期的垫底', () => {
    const text = formatSearchResults(results);
    const titles = text.split('\n').filter((l) => /^\d+\./.test(l));
    expect(titles[0]).toContain('最新');
    expect(titles[1]).toContain('旧闻');
    expect(titles[2]).toContain('无日期');
    expect(titles[2]).toContain('[无日期]');
  });
  it('空结果返回空串（调用方注入空占位）', () => {
    expect(formatSearchResults([])).toBe('');
  });
});

describe('tavilySearch', () => {
  it('解析 Tavily 响应为 SearchResult（含 publishedDate 与 score）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        results: [
          { title: 'T1', url: 'https://x', content: 'C1', published_date: '2026-08-01', score: 0.9 },
          { title: 'T2', url: 'https://y', content: 'C2', published_date: null, score: 0.4 },
        ],
      }),
    })));
    const out = await tavilySearch('query', 'test-key');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ title: 'T1', publishedDate: '2026-08-01', score: 0.9 });
    expect(out[1].score).toBe(0.4);
    // 请求体：topic=news（时效性优先）+ Bearer 鉴权
    const body = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.topic).toBe('news');
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].headers.Authorization).toBe('Bearer test-key');
  });
  it('非 200 抛错（调用方兜底为警告）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, text: async () => 'rate limited' })));
    await expect(tavilySearch('q', 'k')).rejects.toThrow(/429/);
  });
});

describe('filterSearchResults', () => {
  it('按相关度/时效过滤 + 去重 + 截断', () => {
    const past = new Date(Date.now() - 200 * 86_400_000).toISOString(); // 200 天前（超 90 天窗口）
    const results = [
      r('低相关', '2026-08-01', 0.2, 'https://a.com/1'),     // score 过低 → 丢弃
      r('太旧', past, 0.9, 'https://a.com/2'),                 // 日期过旧 → 丢弃
      r('重复1', '2026-08-02', 0.8, 'https://dup.com/a?x=1'),
      r('重复2', '2026-08-03', 0.7, 'https://dup.com/a?x=2'), // 同 URL（去 query）→ 去重，保留 score 高者
      r('好结果', '2026-08-04', 0.75, 'https://a.com/3'),
      r('无日期低分', null, 0.3, 'https://a.com/4'),           // 无日期 + 低分 → 丢弃
      r('无日期保留', null, 0.5, 'https://a.com/5'),           // 无日期但 score 达标 → 保留
    ];
    const out = filterSearchResults(results, 6, 0.35, 90);
    // 过滤后按 score 倒序：重复1(0.8) → 好结果(0.75) → 无日期保留(0.5)
    expect(out.map((x) => x.title)).toEqual(['重复1', '好结果', '无日期保留']);
  });
});

describe('bochaSearch', () => {
  it('解析 Bing 兼容结构 data.webPages.value（标题/URL/摘要/日期）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          webPages: {
            value: [
              { name: 'B1', url: 'https://b1', summary: '摘要1', snippet: '片段', datePublished: '2026-08-06' },
              { name: 'B2', url: 'https://b2', datePublished: null },
            ],
          },
        },
      }),
    })));
    const out = await bochaSearch('中文查询', 'sk-test');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ title: 'B1', publishedDate: '2026-08-06', score: null });
    expect(out[1].publishedDate).toBeNull();
    const body = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.freshness).toBe('noLimit');
    expect(body.summary).toBe(true);
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].headers.Authorization).toBe('Bearer sk-test');
  });
  it('非 200 抛错', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => 'unauthorized' })));
    await expect(bochaSearch('q', 'k')).rejects.toThrow(/401/);
  });
});

describe('runSearch（重试优先于回退）', () => {
  it('主提供者第一次空结果 → 重试成功（不落入回退）', async () => {
    vi.stubEnv('BOCHA_API_KEY', 'bk');
    vi.stubEnv('TAVILY_API_KEY', 'tk');
    vi.stubEnv('SEARCH_PROVIDER', 'bocha');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { webPages: { value: [] } } }) })  // 博查第 1 次空
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { webPages: { value: [{ name: '好结果', url: 'https://b', summary: 's', datePublished: '2026-08-05' }] } } }) }); // 第 2 次成功
    vi.stubGlobal('fetch', fetchMock);
    const out = await runSearch('查询');
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('好结果');
    expect(fetchMock).toHaveBeenCalledTimes(2); // 重试主提供者，未触发 Tavily 回退
  });

  it('主提供者重试耗尽 → 回退另一提供者', async () => {
    vi.stubEnv('BOCHA_API_KEY', 'bk');
    vi.stubEnv('TAVILY_API_KEY', 'tk');
    vi.stubEnv('SEARCH_PROVIDER', 'bocha');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { webPages: { value: [] } } }) })  // 博查空
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { webPages: { value: [] } } }) })  // 博查再空
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [{ title: 'Tavily 兜底', url: 'https://t', content: 'c', published_date: '2026-08-01', score: 0.8 }] }) }); // Tavily 有结果
    vi.stubGlobal('fetch', fetchMock);
    const out = await runSearch('查询');
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Tavily 兜底');
    expect(fetchMock).toHaveBeenCalledTimes(3); // 博查 2 次重试 + Tavily 回退
  });
});

describe('rerankWithSiliconflow / rerankResults', () => {
  it('解析 SiliconFlow rerank 响应（relevance_score）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.2 }] }),
    })));
    const out = await rerankWithSiliconflow('查询', ['d1', 'd2'], 'sk-test');
    expect(out).toEqual([{ index: 1, relevanceScore: 0.9 }, { index: 0, relevanceScore: 0.2 }]);
    const body = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.model).toBe('Qwen/Qwen3-Reranker-8B');
    expect(body.query).toBe('查询');
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].headers.Authorization).toBe('Bearer sk-test');
  });
  it('rerankResults 按分数重排 + 标题相似去重 + instruction 透传', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: [{ index: 2, relevance_score: 0.95 }, { index: 0, relevance_score: 0.5 }, { index: 1, relevance_score: 0.1 }] }),
    })));
    const results: SearchResult[] = [
      r('早报|OpenAI 新模型发布 科技新闻', '2026-08-01', 0.8, 'https://a.com/1'),
      r('早报|OpenAI 新模型发布（另一站）', '2026-08-02', 0.7, 'https://b.com/2'), // 标题相似 → 去重
      r('C 独有内容', '2026-08-03', 0.6, 'https://a.com/3'),
    ];
    const out = await rerankResults('查询', results, 'sk-test', '优先 8 月内容');
    // 排序（C 0.95 最前）后去重：早报两份归一化键相同只留一份（分数高者 = A）
    expect(out.map((x) => x.title)).toEqual(['C 独有内容', '早报|OpenAI 新模型发布 科技新闻']);
    const body = JSON.parse((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.instruction).toBe('优先 8 月内容');
  });
  it('非 200 抛错（调用方跳过 rerank 回退原序）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, text: async () => 'unauthorized' })));
    await expect(rerankWithSiliconflow('q', ['d'], 'k')).rejects.toThrow(/401/);
  });
});

describe('persistResearch', () => {
  it('写入 research.json（可追溯）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sr-'));
    persistResearch(dir, '查询词', [r('T', '2026-08-02', 0.8)]);
    const data = JSON.parse(readFileSync(join(dir, 'research.json'), 'utf8'));
    expect(data.query).toBe('查询词');
    expect(data.results[0].title).toBe('T');
    expect(existsSync(join(dir, 'research.json'))).toBe(true);
  });
});
