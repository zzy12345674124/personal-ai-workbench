import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { queryCommentData, syncCommentSources } from '../server/comment-store.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'comment-store-'));
  const dbPath = join(root, 'db', 'comments.sqlite');
  const collectorRoot = join(root, 'collectors');
  const xhsRoot = join(root, 'xhs');
  const douyinJob = join(collectorRoot, 'douyin', 'collector-douyin-test-123456');
  const bilibiliJob = join(collectorRoot, 'bilibili', 'collector-bilibili-test-123456');
  mkdirSync(douyinJob, { recursive: true });
  mkdirSync(bilibiliJob, { recursive: true });
  mkdirSync(xhsRoot, { recursive: true });
  const recent = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  writeFileSync(join(douyinJob, 'contents.jsonl'), `${JSON.stringify({
    platform: 'douyin', job_id: 'job-d', keyword: '虚构教材', content_id: 'video-1',
    content_url: 'https://www.douyin.com/video/123', title: '虚构视频', published_at: recent,
    fetched_at: recent, like_count: 9, comment_count: 2,
  })}\n`);
  writeFileSync(join(douyinJob, 'comments.jsonl'), [
    {
      platform: 'douyin', job_id: 'job-d', keyword: '虚构教材', content_id: 'video-1',
      comment_id: 'comment-1', parent_comment_id: null, author_display_name: '虚构甲',
      text: '虚构根评论', like_count: 3, published_at: recent, fetched_at: recent, ip_location: '甲地',
    },
    {
      platform: 'douyin', job_id: 'job-d', keyword: '虚构教材', content_id: 'video-1',
      comment_id: 'reply-1', parent_comment_id: 'comment-1', author_display_name: '虚构乙',
      text: '虚构回复', like_count: 8, published_at: recent, fetched_at: recent, ip_location: '乙地',
    },
  ].map(JSON.stringify).join('\n') + '\n');
  writeFileSync(join(bilibiliJob, 'contents.jsonl'), `${JSON.stringify({
    platform: 'bilibili', job_id: 'job-b', keyword: '虚构动画', content_id: 'BV1AB411C7mD',
    content_url: 'https://www.bilibili.com/video/BV1AB411C7mD?spm_id_from=test',
    title: '虚构B站视频', published_at: recent, fetched_at: recent, like_count: 4, comment_count: 1,
  })}\n`);
  writeFileSync(join(bilibiliJob, 'comments.jsonl'), `${JSON.stringify({
    platform: 'bilibili', job_id: 'job-b', keyword: '虚构动画', content_id: 'BV1AB411C7mD',
    comment_id: 'b-comment-1', parent_comment_id: null, author_display_name: '虚构丁',
    text: '虚构B站评论', like_count: 6, published_at: recent, fetched_at: recent, ip_location: '丙地',
  })}\n`);
  writeFileSync(join(xhsRoot, 'note-1.json'), JSON.stringify({
    job_id: 'job-x', keyword: '虚构学习', note_id: 'note-1',
    url: 'https://www.xiaohongshu.com/explore/note-1?xsec_token=secret-token', fetched_at: recent,
    comments: [{ id: 'x-comment-1', nickname: '虚构丙', content: '虚构小红书评论', likes: 5, time: Date.now(), ip: '甲地' }],
  }));
  return { root, dbPath, collectorRoot, xhsRoot };
}

describe('统一评论 SQLite', () => {
  it('导入抖音、小红书和B站，去重并剥离链接令牌', () => {
    const paths = fixture();
    const first = syncCommentSources(paths);
    expect(first.totals).toEqual({ contents: 3, comments: 4, sources: 5 });
    expect(existsSync(paths.dbPath)).toBe(true);
    const second = syncCommentSources(paths);
    expect(second.imported).toEqual({ sources: 0, contents: 0, comments: 0 });
    expect(second.totals.comments).toBe(4);
    expect(readFileSync(paths.dbPath).includes(Buffer.from('secret-token'))).toBe(false);
  });

  it('支持平台、评论类型、日期、搜索和排序筛选', () => {
    const paths = fixture();
    syncCommentSources(paths);
    const all = queryCommentData({ sort: 'likes', date: '7d' }, paths);
    expect(all.stats).toMatchObject({ commentCount: 4, contentCount: 3, platformCount: 3 });
    expect(all.items[0].commentId).toBe('reply-1');
    const xhs = queryCommentData({ platform: 'xiaohongshu' }, paths);
    expect(xhs.stats.commentCount).toBe(1);
    expect(xhs.items[0].contentUrl).toBe('https://www.xiaohongshu.com/explore/note-1');
    const bilibili = queryCommentData({ platform: 'bilibili' }, paths);
    expect(bilibili.stats.commentCount).toBe(1);
    expect(bilibili.items[0]).toMatchObject({ commentId: 'b-comment-1', contentUrl: 'https://www.bilibili.com/video/BV1AB411C7mD' });
    const replies = queryCommentData({ type: 'reply' }, paths);
    expect(replies.items.map((item) => item.commentId)).toEqual(['reply-1']);
    const search = queryCommentData({ search: '虚构丙' }, paths);
    expect(search.stats.commentCount).toBe(1);
  });
});
