// 本地统一评论库：将各平台结果映射为同一 SQLite 结构，并提供只读聚合查询。
import { DatabaseSync } from 'node:sqlite';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { RUNS_DIR } from './paths.js';

export const DEFAULT_COMMENT_DB = join(RUNS_DIR, 'comment-data', 'comments.sqlite');
export const DEFAULT_COLLECTOR_ROOT = join(RUNS_DIR, 'collectors');
export const DEFAULT_XHS_ROOT = join(RUNS_DIR, 'xhs-comments');

const PLATFORM_SET = new Set(['douyin', 'xiaohongshu', 'bilibili']);

function openDatabase(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS content_records (
      platform TEXT NOT NULL,
      content_id TEXT NOT NULL,
      job_id TEXT NOT NULL DEFAULT '',
      keyword TEXT,
      content_url TEXT,
      title TEXT,
      author_display_name TEXT,
      published_at TEXT,
      fetched_at TEXT,
      like_count INTEGER NOT NULL DEFAULT 0,
      comment_count INTEGER NOT NULL DEFAULT 0,
      source_file TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (platform, content_id)
    );
    CREATE TABLE IF NOT EXISTS comment_records (
      platform TEXT NOT NULL,
      content_id TEXT NOT NULL,
      comment_id TEXT NOT NULL,
      job_id TEXT NOT NULL DEFAULT '',
      keyword TEXT,
      parent_comment_id TEXT,
      author_display_name TEXT,
      text TEXT NOT NULL,
      like_count INTEGER NOT NULL DEFAULT 0,
      published_at TEXT,
      fetched_at TEXT,
      ip_location TEXT,
      content_url TEXT,
      source_file TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (platform, content_id, comment_id)
    );
    CREATE TABLE IF NOT EXISTS import_sources (
      source_file TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      record_count INTEGER NOT NULL,
      imported_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_platform ON comment_records(platform);
    CREATE INDEX IF NOT EXISTS idx_comments_published ON comment_records(published_at);
    CREATE INDEX IF NOT EXISTS idx_comments_likes ON comment_records(like_count);
    CREATE INDEX IF NOT EXISTS idx_comments_parent ON comment_records(parent_comment_id);
  `);
  return db;
}

function safeText(value, max = 20_000) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function safeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function safeUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    // 平台临时令牌通常在查询参数中；数据库只保留稳定内容地址。
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function isoTime(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function readJsonl(path) {
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function sourceChanged(db, path) {
  const info = statSync(path);
  const previous = db.prepare('SELECT size_bytes, mtime_ms FROM import_sources WHERE source_file = ?').get(path);
  return {
    changed: !previous || previous.size_bytes !== info.size || previous.mtime_ms !== Math.trunc(info.mtimeMs),
    size: info.size,
    mtime: Math.trunc(info.mtimeMs),
  };
}

function markImported(db, path, kind, info, count) {
  db.prepare(`
    INSERT INTO import_sources(source_file, source_kind, size_bytes, mtime_ms, record_count, imported_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_file) DO UPDATE SET
      source_kind=excluded.source_kind, size_bytes=excluded.size_bytes,
      mtime_ms=excluded.mtime_ms, record_count=excluded.record_count, imported_at=excluded.imported_at
  `).run(path, kind, info.size, info.mtime, count, new Date().toISOString());
}

function upsertContents(db, sourceFile, records) {
  const statement = db.prepare(`
    INSERT INTO content_records(
      platform, content_id, job_id, keyword, content_url, title, author_display_name,
      published_at, fetched_at, like_count, comment_count, source_file, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(platform, content_id) DO UPDATE SET
      job_id=excluded.job_id, keyword=excluded.keyword, content_url=excluded.content_url,
      title=excluded.title, author_display_name=excluded.author_display_name,
      published_at=excluded.published_at, fetched_at=excluded.fetched_at,
      like_count=excluded.like_count, comment_count=excluded.comment_count,
      source_file=excluded.source_file, updated_at=excluded.updated_at
  `);
  db.prepare('DELETE FROM content_records WHERE source_file = ?').run(sourceFile);
  let count = 0;
  for (const item of records) {
    const platform = safeText(item.platform, 40);
    const contentId = safeText(item.content_id, 200);
    if (!PLATFORM_SET.has(platform) || !contentId) continue;
    statement.run(
      platform, contentId, safeText(item.job_id, 200), safeText(item.keyword, 100),
      safeUrl(item.content_url), safeText(item.title, 2_000), safeText(item.author_display_name, 500),
      isoTime(item.published_at), isoTime(item.fetched_at), safeInteger(item.like_count),
      safeInteger(item.comment_count), sourceFile, new Date().toISOString(),
    );
    count += 1;
  }
  return count;
}

function upsertComments(db, sourceFile, records) {
  const statement = db.prepare(`
    INSERT INTO comment_records(
      platform, content_id, comment_id, job_id, keyword, parent_comment_id,
      author_display_name, text, like_count, published_at, fetched_at,
      ip_location, content_url, source_file, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(platform, content_id, comment_id) DO UPDATE SET
      job_id=excluded.job_id, keyword=excluded.keyword, parent_comment_id=excluded.parent_comment_id,
      author_display_name=excluded.author_display_name, text=excluded.text,
      like_count=excluded.like_count, published_at=excluded.published_at,
      fetched_at=excluded.fetched_at, ip_location=excluded.ip_location,
      content_url=excluded.content_url, source_file=excluded.source_file, updated_at=excluded.updated_at
  `);
  db.prepare('DELETE FROM comment_records WHERE source_file = ?').run(sourceFile);
  let count = 0;
  for (const item of records) {
    const platform = safeText(item.platform, 40);
    const contentId = safeText(item.content_id, 200);
    const commentId = safeText(item.comment_id, 200);
    const text = safeText(item.text);
    if (!PLATFORM_SET.has(platform) || !contentId || !commentId || !text) continue;
    statement.run(
      platform, contentId, commentId, safeText(item.job_id, 200), safeText(item.keyword, 100),
      safeText(item.parent_comment_id, 200) || null, safeText(item.author_display_name, 500), text,
      safeInteger(item.like_count), isoTime(item.published_at), isoTime(item.fetched_at),
      safeText(item.ip_location, 100), safeUrl(item.content_url), sourceFile, new Date().toISOString(),
    );
    count += 1;
  }
  return count;
}

function importCollectorJob(db, platform, jobDir) {
  const imported = { sources: 0, contents: 0, comments: 0 };
  const contentsPath = join(jobDir, 'contents.jsonl');
  const commentsPath = join(jobDir, 'comments.jsonl');
  for (const [kind, path, importer] of [
    ['collector-contents', contentsPath, upsertContents],
    ['collector-comments', commentsPath, upsertComments],
  ]) {
    if (!existsSync(path)) continue;
    const info = sourceChanged(db, path);
    if (!info.changed) continue;
    const records = readJsonl(path).map((item) => ({ ...item, platform: item.platform || platform }));
    db.exec('BEGIN IMMEDIATE');
    try {
      const count = importer(db, path, records);
      markImported(db, path, kind, info, count);
      db.exec('COMMIT');
      imported.sources += 1;
      if (kind.endsWith('contents')) imported.contents += count;
      else imported.comments += count;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return imported;
}

function importXhsFile(db, path) {
  const info = sourceChanged(db, path);
  if (!info.changed) return { sources: 0, contents: 0, comments: 0 };
  let data;
  try { data = JSON.parse(readFileSync(path, 'utf8')); } catch { return { sources: 0, contents: 0, comments: 0 }; }
  if (!data || !Array.isArray(data.comments) || !data.note_id) return { sources: 0, contents: 0, comments: 0 };
  const contentId = safeText(data.note_id, 200);
  const stableUrl = safeUrl(data.url);
  const fetchedAt = isoTime(data.fetched_at);
  const base = {
    platform: 'xiaohongshu', content_id: contentId, job_id: safeText(data.job_id, 200),
    keyword: safeText(data.keyword, 100), fetched_at: fetchedAt, content_url: stableUrl,
  };
  const comments = [];
  for (const item of data.comments) {
    comments.push({
      ...base, comment_id: item.id, parent_comment_id: null, author_display_name: item.nickname,
      text: item.content, like_count: item.likes, published_at: item.time, ip_location: item.ip,
    });
    for (const reply of Array.isArray(item.replies) ? item.replies : []) {
      comments.push({
        ...base, comment_id: reply.id, parent_comment_id: item.id,
        author_display_name: reply.nickname, text: reply.content,
        like_count: reply.likes, published_at: reply.time, ip_location: reply.ip,
      });
    }
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const contentCount = upsertContents(db, path, [{
      ...base, title: data.keyword || '', author_display_name: '', published_at: null,
      like_count: 0, comment_count: comments.length,
    }]);
    const commentCount = upsertComments(db, path, comments);
    markImported(db, path, 'xiaohongshu-json', info, commentCount);
    db.exec('COMMIT');
    return { sources: 1, contents: contentCount, comments: commentCount };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function addTotals(target, value) {
  target.sources += value.sources;
  target.contents += value.contents;
  target.comments += value.comments;
}

export function syncCommentSources({
  dbPath = process.env.COMMENT_DB_PATH || DEFAULT_COMMENT_DB,
  collectorRoot = process.env.COMMENT_COLLECTOR_ROOT || DEFAULT_COLLECTOR_ROOT,
  xhsRoot = process.env.COMMENT_XHS_ROOT || DEFAULT_XHS_ROOT,
} = {}) {
  const db = openDatabase(dbPath);
  const imported = { sources: 0, contents: 0, comments: 0 };
  try {
    if (existsSync(collectorRoot)) {
      for (const platformEntry of readdirSync(collectorRoot, { withFileTypes: true })) {
        if (!platformEntry.isDirectory() || !PLATFORM_SET.has(platformEntry.name)) continue;
        const platformDir = join(collectorRoot, platformEntry.name);
        for (const jobEntry of readdirSync(platformDir, { withFileTypes: true })) {
          if (jobEntry.isDirectory()) addTotals(imported, importCollectorJob(db, platformEntry.name, join(platformDir, jobEntry.name)));
        }
      }
    }
    if (existsSync(xhsRoot)) {
      for (const entry of readdirSync(xhsRoot, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.endsWith('.job.json') || entry.name === 'expand-usage.json') continue;
        addTotals(imported, importXhsFile(db, join(xhsRoot, entry.name)));
      }
    }
    const totals = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM content_records) AS contents,
        (SELECT COUNT(*) FROM comment_records) AS comments,
        (SELECT COUNT(*) FROM import_sources) AS sources
    `).get();
    return { imported, totals };
  } finally {
    db.close();
  }
}

function normalizedFilters(raw = {}) {
  const platform = PLATFORM_SET.has(raw.platform) ? raw.platform : 'all';
  const sort = ['newest', 'oldest', 'likes'].includes(raw.sort) ? raw.sort : 'newest';
  const date = ['7d', '30d', '365d'].includes(raw.date) ? raw.date : 'all';
  const type = ['root', 'reply'].includes(raw.type) ? raw.type : 'all';
  return { platform, sort, date, type, search: safeText(raw.search, 100).trim() };
}

function whereClause(filters) {
  const clauses = [];
  const params = [];
  if (filters.platform !== 'all') { clauses.push('platform = ?'); params.push(filters.platform); }
  if (filters.type === 'root') clauses.push("(parent_comment_id IS NULL OR parent_comment_id = '')");
  if (filters.type === 'reply') clauses.push("parent_comment_id IS NOT NULL AND parent_comment_id <> ''");
  if (filters.date !== 'all') {
    const days = { '7d': 7, '30d': 30, '365d': 365 }[filters.date];
    clauses.push("published_at IS NOT NULL AND julianday(published_at) >= julianday('now', ?)");
    params.push(`-${days} days`);
  }
  if (filters.search) {
    clauses.push('(instr(lower(text), lower(?)) > 0 OR instr(lower(author_display_name), lower(?)) > 0 OR instr(lower(keyword), lower(?)) > 0)');
    params.push(filters.search, filters.search, filters.search);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export function queryCommentData(rawFilters = {}, {
  dbPath = process.env.COMMENT_DB_PATH || DEFAULT_COMMENT_DB,
} = {}) {
  const db = openDatabase(dbPath);
  try {
    const filters = normalizedFilters(rawFilters);
    const where = whereClause(filters);
    const order = filters.sort === 'likes'
      ? 'like_count DESC, published_at DESC'
      : filters.sort === 'oldest' ? 'published_at IS NULL, published_at ASC' : 'published_at IS NULL, published_at DESC';
    const stats = db.prepare(`
      SELECT COUNT(*) AS commentCount,
        COUNT(DISTINCT platform || char(31) || content_id) AS contentCount,
        COALESCE(SUM(like_count), 0) AS likeCount,
        COUNT(DISTINCT platform) AS platformCount
      FROM comment_records ${where.sql}
    `).get(...where.params);
    const platformCounts = db.prepare(`
      SELECT platform, COUNT(*) AS count FROM comment_records ${where.sql}
      GROUP BY platform ORDER BY count DESC
    `).all(...where.params);
    const ipRows = db.prepare(`
      SELECT CASE WHEN trim(ip_location) = '' THEN '未知' ELSE ip_location END AS label, COUNT(*) AS count
      FROM comment_records ${where.sql}
      GROUP BY label ORDER BY count DESC
    `).all(...where.params);
    const topIp = ipRows.slice(0, 7);
    if (ipRows.length > 7) topIp.push({ label: '其他', count: ipRows.slice(7).reduce((sum, row) => sum + Number(row.count), 0) });
    const items = db.prepare(`
      SELECT platform, content_id AS contentId, comment_id AS commentId,
        parent_comment_id AS parentCommentId, author_display_name AS author,
        text, like_count AS likeCount, published_at AS publishedAt,
        fetched_at AS fetchedAt, ip_location AS ipLocation,
        keyword,
        COALESCE(content_url, (
          SELECT content_records.content_url FROM content_records
          WHERE content_records.platform = comment_records.platform
            AND content_records.content_id = comment_records.content_id
        )) AS contentUrl
      FROM comment_records ${where.sql} ORDER BY ${order} LIMIT 200
    `).all(...where.params);
    return {
      filters, stats, platformCounts, ipDistribution: topIp, items,
      truncated: Number(stats.commentCount) > items.length,
    };
  } finally {
    db.close();
  }
}
