export type ApiPreset = 'openai' | 'gemini' | 'openrouter' | 'ollama' | 'vllm' | 'compatible';
export interface ApiProfileConfig {
  name: string;
  preset: ApiPreset;
  baseUrl: string;
  model: string;
  network: 'cloud' | 'local';
  auth: 'bearer' | 'none';
  enabled: boolean;
  timeoutMs: number;
  maxOutputTokens: number;
  maxConcurrent: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  pricesConfirmed: boolean;
  tokenParameter: 'max_completion_tokens' | 'max_tokens';
  includeUsage: boolean;
  sendStore: boolean;
}
export interface ApiTestResult {
  ok: boolean;
  kind: 'models' | 'completion';
  checkedAt: string;
  latencyMs: number;
  firstTokenMs?: number;
  model: string;
  errorCode?: string;
  message: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  usageEstimated?: boolean;
  reply?: string;
  revision: number;
}
export interface ApiProfile extends ApiProfileConfig {
  id: string;
  revision: number;
  ready: boolean;
  hasKey: boolean;
  createdAt: string;
  updatedAt: string;
  lastTest: ApiTestResult | null;
  inFlight: number;
  cooldownUntil: string | null;
}
export interface ApiPoolRouting {
  enabled: boolean;
  strategy: 'manual' | 'round_robin';
  simple: string[];
  complex: string[];
}
export interface ApiPoolPreset {
  id: ApiPreset;
  name: string;
  description: string;
  docsUrl: string;
  defaults: Pick<
    ApiProfileConfig,
    'baseUrl' | 'network' | 'auth' | 'tokenParameter' | 'includeUsage' | 'sendStore'
  >;
}
export interface ApiProfileMetrics {
  id: string;
  calls: number;
  errors: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  averageLatencyMs: number;
}
