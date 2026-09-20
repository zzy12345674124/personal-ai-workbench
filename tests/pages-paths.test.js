import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const changelogPanel = readFileSync(
  new URL('../web/panels/changelog.js', import.meta.url),
  'utf8',
);

test('GitHub Pages 子路径下使用相对路径加载更新日志', () => {
  assert.match(changelogPanel, /fetch\('\.\/changelog\.json'/);
  assert.doesNotMatch(changelogPanel, /fetch\('\/changelog\.json'/);
});
