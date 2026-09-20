import { createReadStream, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const sourceRoot = resolve(process.argv[2] ?? '../project_008_个人工作台/runs/collectors');
const outputFile = resolve(process.argv[3] ?? 'public-data/comments.anonymized.json');

function findCommentFiles(root) {
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) found.push(...findCommentFiles(full));
    else if (entry.name === 'comments.jsonl') found.push(full);
  }
  return found;
}

function normalizeProvince(value) {
  const text = String(value ?? '').trim().replace(/^IP(?:属地|地址)?[:：]?\s*/i, '');
  return text.split(/[\s,，/]/)[0].slice(0, 12);
}

const rows = [];
for (const file of findCommentFiles(sourceRoot)) {
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let source;
    try { source = JSON.parse(line); } catch { continue; }
    const text = String(source.text ?? '').trim();
    if (!text) continue;
    rows.push({
      id: `comment-${String(rows.length + 1).padStart(4, '0')}`,
      text,
      likes: Number(source.like_count) || 0,
      publishedAt: source.published_at || null,
      province: normalizeProvince(source.ip_location),
      platform: String(source.platform ?? 'unknown'),
      keyword: String(source.keyword ?? ''),
    });
  }
}

const output = {
  anonymized: true,
  identityFieldsRemoved: ['author_display_name', 'content_id', 'comment_id', 'parent_comment_id', 'job_id', 'platform_extra'],
  count: rows.length,
  comments: rows,
};
mkdirSync(dirname(outputFile), { recursive: true });
writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Exported ${rows.length} anonymized comments to ${outputFile}`);
