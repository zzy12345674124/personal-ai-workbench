import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(import.meta.dirname, '..', 'web/panels/xhs-viz.js'), 'utf8');

describe('评论数据分析面板', () => {
  it('使用统一数据库 API，不再嵌入小红书静态页', () => {
    expect(source).toContain('/api/comments/data');
    expect(source).not.toContain('<iframe');
    expect(source).not.toContain('/xhs-viz.html');
  });

  it('按要求提供平台、排序、发布日期、评论类型和搜索筛选', () => {
    for (const label of ['平台', '排序方式', '发布日期', '评论类型', '搜索评论、作者或关键词']) {
      expect(source).toContain(label);
    }
    expect(source).toContain("value: 'douyin'");
    expect(source).toContain("value: 'xiaohongshu'");
    expect(source).toContain("value: 'bilibili'");
    expect(source).toContain('comment-filter-menu');
    expect(source).not.toContain('<select');
  });
});
