import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

describe('多平台采集面板接线', () => {
  it('注册独立工具且不覆盖旧小红书入口', () => {
    const tools = JSON.parse(readFileSync(join(root, 'web/tools.json'), 'utf8')).tools;
    expect(tools.find((tool) => tool.id === 'collector')).toMatchObject({ panel: 'panels/collector.js' });
    expect(tools.find((tool) => tool.id === 'xhs-crawler')).toBeTruthy();
  });

  it('只调用公共采集 API，并保留可见浏览器和硬上限', () => {
    const source = readFileSync(join(root, 'web/panels/collector.js'), 'utf8');
    expect(source).toContain('/api/collector/capabilities');
    expect(source).toContain('/api/collector/start');
    expect(source).toContain('/api/collector/status');
    expect(source).toContain('/api/collector/pause');
    expect(source).toContain('/api/collector/resume');
    expect(source).toContain('/api/collector/stop');
    expect(source).not.toContain('/api/xhs');
    expect(source).toContain("browser: { visible: true }");
    expect(source).toContain('maxRuntimeMinutes');
  });

  it('原小红书三栏界面同时接入抖音与小红书，不再启动旧采集链路', () => {
    const source = readFileSync(join(root, 'web/panels/xhs-crawler.js'), 'utf8');
    expect(source).toContain('xhs2-card-l');
    expect(source).toContain('xhs2-card-m');
    expect(source).toContain('xhs2-log-card');
    expect(source).toContain("platform: 'douyin'");
    expect(source).toContain("platform: 'xiaohongshu'");
    expect(source).toContain("platform: 'bilibili'");
    expect(source).toContain('/api/collector/capabilities');
    expect(source).toContain('/api/collector/start');
    expect(source).toContain('/api/collector/status');
    expect(source).toContain('/api/collector/pause');
    expect(source).toContain('/api/collector/resume');
    expect(source).toContain('/api/collector/stop');
    expect(source).toContain('/api/xhs/expand');
    expect(source).not.toContain('/api/xhs/start');
    expect(source).not.toContain('/api/xhs/status');
    expect(source).not.toContain('/api/xhs/stop');
  });

  it('两个采集入口都把 UTC 事件时间显示为浏览器本地时间', () => {
    for (const panel of ['collector.js', 'xhs-crawler.js']) {
      const source = readFileSync(join(root, 'web/panels', panel), 'utf8');
      expect(source).toContain('formatEventTime(event.at)');
      expect(source).toContain("toLocaleString('zh-CN'");
    }
  });

  it('Cookie 失效时提示在 CloakBrowser 重新输入账号或扫码', () => {
    for (const panel of ['collector.js', 'xhs-crawler.js']) {
      const source = readFileSync(join(root, 'web/panels', panel), 'utf8');
      expect(source).toContain('登录已失效');
      expect(source).toContain('输入账号或扫码');
      expect(source).toContain('自动继续');
    }
  });
});
