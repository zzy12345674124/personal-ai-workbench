import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLlmProvider, redactLlmProvider } from '../projects/008-personal-workbench/server/llm-provider-config.js';

const config = {
  videoGeneration: { enabled: true, baseUrl: 'https://video.example/v1/', apiKeyEnv: 'VIDEO_KEY', model: 'video-model', timeoutMs: 30000 },
  dataCrawling: { enabled: true, baseUrl: 'https://crawler.example/v1', apiKeyEnv: 'CRAWLER_KEY', model: 'crawler-model' },
};

test('video generation and crawling resolve independent providers', () => {
  const video = resolveLlmProvider(config, 'videoGeneration', { VIDEO_KEY: 'video-secret' });
  const crawler = resolveLlmProvider(config, 'dataCrawling', { CRAWLER_KEY: 'crawler-secret' });
  assert.equal(video.baseUrl, 'https://video.example/v1');
  assert.equal(video.apiKey, 'video-secret');
  assert.equal(crawler.model, 'crawler-model');
  assert.equal(crawler.apiKey, 'crawler-secret');
});

test('disabled provider never requires a key', () => {
  assert.deepEqual(resolveLlmProvider({ dataCrawling: { enabled: false } }, 'dataCrawling', {}), { enabled: false });
});

test('logs can use a redacted provider without exposing the key', () => {
  const safe = redactLlmProvider(resolveLlmProvider(config, 'videoGeneration', { VIDEO_KEY: 'video-secret' }));
  assert.equal(safe.apiKey, undefined);
  assert.equal(safe.apiKeyConfigured, true);
});
