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
  /** Operator supplied quality prior used by the adaptive gateway. */
  qualityScore?: number;
  /** Whether this provider may receive student-specific evidence. */
  allowPersonalData?: boolean;
  /** Stable data-processing boundary. Personal retries may not cross it. */
  trustGroup?: string;
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
  qualityScore: number;
  allowPersonalData: boolean;
  trustGroup: string;
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
export type ApiGatewayMode = 'off' | 'shadow' | 'active';
export interface ApiGatewayWeights {
  reliability: number;
  latency: number;
  cost: number;
  load: number;
  quality: number;
}
export interface ApiGatewayPolicy {
  schemaVersion: 1;
  mode: ApiGatewayMode;
  maxAttempts: number;
  totalDeadlineMs: number;
  explorationRate: number;
  failureThreshold: number;
  cooldownSeconds: number;
  probeIntervalMinutes: number;
  weights: ApiGatewayWeights;
}
export interface ApiGatewayScore {
  providerId: string;
  score: number;
  eligible: boolean;
  reason?: string;
  components: ApiGatewayWeights;
}
export interface ApiGatewayAttempt {
  id: string;
  requestId: string;
  attemptNo: number;
  providerId: string;
  revision: number;
  lane: 'simple' | 'complex';
  outcome: string;
  errorCode: string | null;
  committed: boolean;
  latencyMs: number | null;
  firstTokenMs: number | null;
  score: ApiGatewayScore | null;
  createdAt: string;
}
export interface ApiPoolReadiness {
  enabled: boolean;
  ready: boolean;
  lanes: {
    simple: boolean;
    complex: boolean;
  };
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
