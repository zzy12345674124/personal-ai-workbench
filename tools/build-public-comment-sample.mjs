import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildBalancedSample } from './comment-privacy.mjs';

const inputFile = resolve(process.argv[2] ?? 'public-data/comments.anonymized.json');
const outputFile = resolve(process.argv[3] ?? 'public-data/comments.sample.json');
const reportFile = resolve(process.argv[4] ?? 'public-data/comments.sample.report.json');
const perPlatform = Number.parseInt(process.argv[5] ?? '20', 10);

const source = JSON.parse(readFileSync(inputFile, 'utf8'));
const result = buildBalancedSample(source.comments ?? [], perPlatform);
const publicData = {
  anonymized: true,
  sampleOnly: true,
  notice: '评论样本仅用于项目展示与研究，不随 MIT 软件许可证授权再次传播。',
  identityFieldsRemoved: source.identityFieldsRemoved ?? [],
  count: result.selected.length,
  comments: result.selected,
};
const report = {
  sourceCount: source.comments?.length ?? 0,
  publicCount: result.selected.length,
  excludedForPossibleContactInfo: result.excluded.length,
  excludedIds: result.excluded,
  platformCounts: result.platformCounts,
};

mkdirSync(dirname(outputFile), { recursive: true });
writeFileSync(outputFile, `${JSON.stringify(publicData, null, 2)}\n`, 'utf8');
writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Created ${result.selected.length} public comments; excluded ${result.excluded.length} possible contact records.`);
