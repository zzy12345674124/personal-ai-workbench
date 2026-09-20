import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export function hashText(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function readTaskDocument(taskFile) {
  const text = readFileSync(taskFile, 'utf8');
  return { text, hash: hashText(text) };
}

export function extractSection(text, heading, nextHeading) {
  const start = text.indexOf(heading);
  if (start < 0) throw new Error(`MISSING_DOCUMENT_SECTION:${heading}`);
  const end = nextHeading ? text.indexOf(nextHeading, start + heading.length) : text.length;
  if (end < 0) throw new Error(`MISSING_DOCUMENT_SECTION:${nextHeading}`);
  return text.slice(start, end);
}

export function readClaudeWriteback(text) {
  const section = extractSection(text, '## Claude 执行回填', '## Codex 复核');
  const status = section.match(/^- 状态：`([^`]+)`/m)?.[1] ?? null;
  const completedTasks = [...section.matchAll(/^- \[x\] 任务 (\d+)：/gim)].map((match) => Number(match[1]));
  return { status, completedTasks, sectionHash: hashText(section) };
}

function escapeInline(value) {
  return String(value ?? '').replaceAll('\r', ' ').replaceAll('\n', ' ').replaceAll('`', "'").trim();
}

function renderFindings(findings) {
  if (!findings.length) return '- 无阻断问题。';
  return findings
    .map((finding, index) => {
      const location = finding.file ? ` · ${escapeInline(finding.file)}${finding.line ? `:${finding.line}` : ''}` : '';
      return `${index + 1}. **${escapeInline(finding.severity)}｜${escapeInline(finding.title)}**${location}\n   - ${escapeInline(finding.detail)}\n   - 要求：${escapeInline(finding.requiredChange)}`;
    })
    .join('\n');
}

export function renderCodexReview(review, reviewedAt = new Date().toISOString()) {
  const label = review.decision === 'approved' ? '复核通过' : review.decision === 'changes_requested' ? '需返工' : '受阻待确认';
  return `## Codex 复核

> 本节由协同编排器根据 Codex 的结构化只读审核结果确定性写入。

- 复核状态：\`${label}\`
- 审核时间：\`${escapeInline(reviewedAt)}\`
- 审核摘要：${escapeInline(review.summary)}

### 审核发现

${renderFindings(review.findings)}
`;
}

export function writeCodexReview(taskFile, review, reviewedAt) {
  const { text } = readTaskDocument(taskFile);
  const start = text.indexOf('## Codex 复核');
  if (start < 0) throw new Error('MISSING_DOCUMENT_SECTION:## Codex 复核');
  const nextText = `${text.slice(0, start)}${renderCodexReview(review, reviewedAt)}`;
  writeFileSync(taskFile, nextText, 'utf8');
  return { text: nextText, hash: hashText(nextText) };
}

export function validateReview(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('BAD_CODEX_REVIEW');
  if (!['approved', 'changes_requested', 'blocked'].includes(input.decision)) throw new Error('BAD_CODEX_REVIEW_DECISION');
  if (typeof input.summary !== 'string' || input.summary.trim().length === 0) throw new Error('BAD_CODEX_REVIEW_SUMMARY');
  if (!Array.isArray(input.findings)) throw new Error('BAD_CODEX_REVIEW_FINDINGS');
  const findings = input.findings.map((finding) => {
    if (!finding || typeof finding !== 'object') throw new Error('BAD_CODEX_REVIEW_FINDING');
    if (!['P0', 'P1', 'P2', 'P3'].includes(finding.severity)) throw new Error('BAD_CODEX_REVIEW_SEVERITY');
    for (const key of ['title', 'detail', 'requiredChange']) {
      if (typeof finding[key] !== 'string' || finding[key].trim().length === 0) throw new Error(`BAD_CODEX_REVIEW_${key.toUpperCase()}`);
    }
    if (finding.file !== null && typeof finding.file !== 'string') throw new Error('BAD_CODEX_REVIEW_FILE');
    if (finding.line !== null && (!Number.isInteger(finding.line) || finding.line < 1)) throw new Error('BAD_CODEX_REVIEW_LINE');
    return {
      severity: finding.severity,
      title: finding.title.trim(),
      detail: finding.detail.trim(),
      requiredChange: finding.requiredChange.trim(),
      file: finding.file,
      line: finding.line,
    };
  });
  if (input.decision === 'approved' && findings.some((item) => item.severity === 'P0' || item.severity === 'P1')) {
    throw new Error('APPROVED_REVIEW_HAS_BLOCKING_FINDINGS');
  }
  return { decision: input.decision, summary: input.summary.trim(), findings };
}
