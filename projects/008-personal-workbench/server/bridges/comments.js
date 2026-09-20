// 统一评论数据 API：查询前增量同步各平台结果，数据库与网络均只在本机使用。
import { queryCommentData, syncCommentSources } from '../comment-store.js';

export async function commentsRouter(req, res, url) {
  const json = (status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };
  if (url.pathname === '/api/comments/data' && req.method === 'GET') {
    try {
      const sync = syncCommentSources();
      const data = queryCommentData(Object.fromEntries(url.searchParams));
      return json(200, { ok: true, data: { ...data, sync } });
    } catch (error) {
      return json(500, { ok: false, error: `COMMENTS_DB: ${error.message}` });
    }
  }
  return json(404, { ok: false, error: 'COMMENTS_ROUTE_NOT_FOUND' });
}
