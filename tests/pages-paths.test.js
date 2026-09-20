import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const changelogPanel = readFileSync(
  new URL('../web/panels/changelog.js', import.meta.url),
  'utf8',
);
const tools = JSON.parse(readFileSync(new URL('../web/tools.json', import.meta.url), 'utf8'));

test('GitHub Pages 子路径下使用相对路径加载更新日志', () => {
  assert.match(changelogPanel, /fetch\('\.\/changelog\.json'/);
  assert.doesNotMatch(changelogPanel, /fetch\('\/changelog\.json'/);
});

test('更新日志模块带版本参数以绕过浏览器旧缓存', () => {
  const changelog = tools.tools.find((tool) => tool.id === 'changelog');
  assert.match(changelog.panel, /^panels\/changelog\.js\?v=[a-z0-9]+$/);
});
