import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBalancedSample, detectContactInfo } from '../tools/comment-privacy.mjs';

test('contact detector identifies common personal contact formats', () => {
  assert.deepEqual(detectContactInfo('联系 test@example.com'), ['email']);
  assert.deepEqual(detectContactInfo('手机号 13800138000'), ['mainland-phone']);
  assert.deepEqual(detectContactInfo('微信：sample_user'), ['wechat-id']);
});

test('balanced sample excludes contact records and limits each platform', () => {
  const comments = [
    { id: '1', platform: 'a', text: '普通评论' },
    { id: '2', platform: 'a', text: '另一条评论' },
    { id: '3', platform: 'b', text: '联系 test@example.com' },
    { id: '4', platform: 'b', text: '安全评论' },
  ];
  const result = buildBalancedSample(comments, 1);
  assert.deepEqual(result.selected.map((item) => item.id), ['1', '4']);
  assert.equal(result.excluded.length, 1);
});
