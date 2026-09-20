const SCENARIOS = new Set(['videoGeneration', 'dataCrawling']);

export function resolveLlmProvider(config, scenario, env = process.env) {
  if (!SCENARIOS.has(scenario)) throw new Error(`Unsupported LLM scenario: ${scenario}`);
  const item = config?.[scenario] ?? {};
  if (!item.enabled) return { enabled: false };

  const baseUrl = String(item.baseUrl ?? '').trim().replace(/\/$/, '');
  const model = String(item.model ?? '').trim();
  const apiKeyEnv = String(item.apiKeyEnv ?? '').trim();
  if (!baseUrl || !model || !apiKeyEnv) throw new Error(`${scenario} LLM configuration is incomplete`);

  let parsed;
  try { parsed = new URL(baseUrl); } catch { throw new Error(`${scenario} baseUrl is invalid`); }
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error(`${scenario} baseUrl must use HTTP(S)`);

  const apiKey = env[apiKeyEnv];
  if (!apiKey) throw new Error(`${scenario} API key environment variable is not set`);
  return {
    enabled: true,
    baseUrl,
    model,
    apiKey,
    timeoutMs: Number.isFinite(item.timeoutMs) ? item.timeoutMs : 60000,
  };
}

export function redactLlmProvider(provider) {
  if (!provider?.enabled) return { enabled: false };
  const { apiKey: _secret, ...safe } = provider;
  return { ...safe, apiKeyConfigured: true };
}
