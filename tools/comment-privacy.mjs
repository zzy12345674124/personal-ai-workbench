const CONTACT_PATTERNS = [
  ['email', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ['mainland-phone', /(?<!\d)1[3-9]\d{9}(?!\d)/],
  ['qq-number', /(?:QQ|扣扣|企鹅)\s*[:：号]?\s*[1-9]\d{4,11}/i],
  ['wechat-id', /(?:微信|V信|VX|WeChat)\s*[:：号]?\s*[A-Za-z][-_A-Za-z0-9]{5,19}/i],
  ['url', /(?:https?:\/\/|www\.)\S+/i],
];

export function detectContactInfo(text) {
  const value = String(text ?? '');
  return CONTACT_PATTERNS.filter(([, pattern]) => pattern.test(value)).map(([name]) => name);
}

export function buildBalancedSample(comments, perPlatform = 20) {
  const selected = [];
  const excluded = [];
  const counts = new Map();
  for (const comment of comments) {
    const reasons = detectContactInfo(comment.text);
    if (reasons.length) {
      excluded.push({ id: comment.id, reasons });
      continue;
    }
    const platform = String(comment.platform ?? 'unknown');
    const count = counts.get(platform) ?? 0;
    if (count >= perPlatform) continue;
    selected.push(comment);
    counts.set(platform, count + 1);
  }
  return { selected, excluded, platformCounts: Object.fromEntries(counts) };
}
