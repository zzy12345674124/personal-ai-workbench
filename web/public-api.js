let commentCache;

async function loadComments() {
  if (!commentCache) {
    const response = await fetch('./fixtures/comments.sample.json');
    if (!response.ok) throw new Error('匿名评论样本读取失败');
    commentCache = await response.json();
  }
  return commentCache.comments ?? [];
}

function commentData(items, url) {
  const params = new URL(url, location.href).searchParams;
  const platform = params.get('platform') || 'all';
  const search = (params.get('search') || '').toLowerCase();
  const sort = params.get('sort') || 'newest';
  let rows = items.filter((item) => (platform === 'all' || item.platform === platform)
    && (!search || `${item.text} ${item.keyword}`.toLowerCase().includes(search)));
  rows = [...rows].sort((a, b) => sort === 'likes'
    ? b.likes - a.likes
    : String(sort === 'oldest' ? a.publishedAt : b.publishedAt).localeCompare(String(sort === 'oldest' ? b.publishedAt : a.publishedAt)));
  const group = (key) => Object.entries(rows.reduce((result, item) => {
    const label = item[key] || '未标注';
    result[label] = (result[label] || 0) + 1;
    return result;
  }, {})).map(([label, count]) => ({ label, platform: label, count })).sort((a, b) => b.count - a.count);
  return {
    stats: {
      commentCount: rows.length,
      contentCount: new Set(rows.map((item) => item.keyword)).size,
      likeCount: rows.reduce((sum, item) => sum + Number(item.likes || 0), 0),
      platformCount: new Set(rows.map((item) => item.platform)).size,
    },
    ipDistribution: group('province'),
    platformCounts: group('platform'),
    items: rows.map((item) => ({
      platform: item.platform,
      author: '匿名访客',
      text: item.text,
      likeCount: item.likes,
      ipLocation: item.province,
      publishedAt: item.publishedAt,
      parentCommentId: null,
    })),
    truncated: false,
    sync: { imported: { sources: 0, comments: 0 } },
  };
}

export async function publicApi(path, opts = {}) {
  if (opts.method && opts.method !== 'GET') {
    return { ok: false, error: '公开浏览模式不会执行真实任务' };
  }
  if (path === '/api/health') return { ok: true, data: { mode: 'public' } };
  if (path.startsWith('/api/comments/data')) return { ok: true, data: commentData(await loadComments(), path) };
  if (path === '/api/collector/capabilities') return {
    ok: true,
    data: {
      pythonConfigured: true,
      realCollectionEnabled: false,
      platforms: ['douyin', 'xiaohongshu', 'bilibili'].map((platform) => ({ platform, ready: true })),
    },
  };
  if (path === '/api/sessions/status') return {
    ok: true,
    data: {
      processRunning: false,
      projects: [
        { name: '视频流水线', count: 18 },
        { name: '个人工作台', count: 26 },
        { name: '素材与动效', count: 12 },
      ],
      recentSessions: [],
    },
  };
  if (path === '/api/voice/status') return { ok: true, data: { available: false } };
  if (path === '/api/video/list') return { ok: true, data: { runs: [] } };
  if (path === '/api/template-preview/status') return { ok: true, data: { running: false } };
  if (path === '/api/assets/list') return { ok: true, data: { dirs: [] } };
  if (path.startsWith('/api/assets/versions')) return { ok: true, data: { versions: [] } };
  return { ok: false, error: '该功能只在本地工作台中运行' };
}
