import { z } from 'zod';
import type {
  ApiGatewayPolicy,
  ApiGatewayScore,
  ApiGatewayWeights,
  ApiProfileConfig,
} from '@nau/domain';

export const DEFAULT_GATEWAY_POLICY: ApiGatewayPolicy = Object.freeze({
  schemaVersion: 1,
  mode: 'off',
  maxAttempts: 2,
  totalDeadlineMs: 45_000,
  explorationRate: 0.05,
  failureThreshold: 3,
  cooldownSeconds: 30,
  probeIntervalMinutes: 0,
  weights: Object.freeze({
    reliability: 0.35,
    latency: 0.2,
    cost: 0.2,
    load: 0.05,
    quality: 0.2,
  }),
});

const weightsSchema = z
  .object({
    reliability: z.number().finite().nonnegative().max(1_000),
    latency: z.number().finite().nonnegative().max(1_000),
    cost: z.number().finite().nonnegative().max(1_000),
    load: z.number().finite().nonnegative().max(1_000),
    quality: z.number().finite().nonnegative().max(1_000),
  })
  .strict();

export const gatewayPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.enum(['off', 'shadow', 'active']),
    maxAttempts: z.number().int().min(1).max(3),
    totalDeadlineMs: z.number().int().min(5_000).max(120_000),
    explorationRate: z.number().finite().min(0).max(0.25),
    failureThreshold: z.number().int().min(1).max(10),
    cooldownSeconds: z.number().int().min(5).max(600),
    probeIntervalMinutes: z.number().int().min(0).max(1_440),
    weights: weightsSchema,
  })
  .strict()
  .transform((policy): ApiGatewayPolicy => ({
    ...policy,
    weights: normalizeWeights(policy.weights),
  }));

export function normalizeWeights(weights: ApiGatewayWeights): ApiGatewayWeights {
  const sum = Object.values(weights).reduce((total, value) => total + value, 0);
  if (!Number.isFinite(sum) || sum <= 0) return { ...DEFAULT_GATEWAY_POLICY.weights };
  return {
    reliability: weights.reliability / sum,
    latency: weights.latency / sum,
    cost: weights.cost / sum,
    load: weights.load / sum,
    quality: weights.quality / sum,
  };
}

export function parseGatewayPolicy(value: unknown): ApiGatewayPolicy {
  if (value === null || value === undefined) return structuredClone(DEFAULT_GATEWAY_POLICY);
  return gatewayPolicySchema.parse(value);
}

export function deriveTrustGroup(baseUrl: string) {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return hostname
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);
  } catch {
    return '';
  }
}

export function normalizeProfileConfig(
  config: ApiProfileConfig,
  fallbackTrustGroup?: string,
): Required<ApiProfileConfig> {
  return {
    ...config,
    qualityScore: config.qualityScore ?? 70,
    allowPersonalData: config.allowPersonalData ?? false,
    trustGroup: config.trustGroup?.trim() || fallbackTrustGroup || deriveTrustGroup(config.baseUrl),
  } as Required<ApiProfileConfig>;
}

export interface GatewayProviderState {
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  ewmaLatencyMs: number | null;
  ewmaFirstTokenMs: number | null;
  openUntil: Date | string | null;
}

export interface GatewayCandidateInput {
  providerId: string;
  /** Hard gates run before scoring; excluded providers must not distort peer normalization. */
  eligible?: boolean;
  state: GatewayProviderState;
  expectedCostUsd: number;
  activeLeases: number;
  maxConcurrent: number;
  qualityScore: number;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/** Pure scoring keeps selection explainable and makes the stored snapshot reproducible. */
export function scoreCandidates(
  candidates: GatewayCandidateInput[],
  weights: ApiGatewayWeights,
): ApiGatewayScore[] {
  const normalized = normalizeWeights(weights);
  const maximumCost = Math.max(
    ...candidates
      .filter((candidate) => candidate.eligible !== false)
      .map((candidate) => candidate.expectedCostUsd),
    0,
  );
  return candidates.map((candidate) => {
    const successes = Math.max(0, candidate.state.successCount),
      failures = Math.max(0, candidate.state.failureCount),
      // Beta(2,2) avoids treating a provider with one lucky call as perfectly reliable.
      reliability = (successes + 2) / (successes + failures + 4),
      latencyMs =
        candidate.state.ewmaLatencyMs === null
          ? 10_000
          : candidate.state.ewmaLatencyMs * 0.65 +
            (candidate.state.ewmaFirstTokenMs ?? candidate.state.ewmaLatencyMs) * 0.35,
      latency = 1 / (1 + Math.max(0, latencyMs) / 10_000),
      cost = maximumCost <= 0 ? 1 : 1 - candidate.expectedCostUsd / (maximumCost * 1.05),
      load = 1 - candidate.activeLeases / Math.max(1, candidate.maxConcurrent),
      quality = candidate.qualityScore / 100,
      components = {
        reliability: clamp01(reliability),
        latency: clamp01(latency),
        cost: clamp01(cost),
        load: clamp01(load),
        quality: clamp01(quality),
      },
      score =
        components.reliability * normalized.reliability +
        components.latency * normalized.latency +
        components.cost * normalized.cost +
        components.load * normalized.load +
        components.quality * normalized.quality;
    return {
      providerId: candidate.providerId,
      eligible: candidate.eligible !== false,
      score: Math.round(score * 1_000_000) / 1_000_000,
      components,
    };
  });
}

export const ADAPTIVE_RETRYABLE_ERRORS = new Set([
  'BUSY',
  'CONNECTION_FAILED',
  'COOLDOWN',
  'EMPTY_RESPONSE',
  'RATE_LIMIT',
  'TIMEOUT',
  'UPSTREAM_ERROR',
]);

export function isAdaptiveRetryable(code: string) {
  return ADAPTIVE_RETRYABLE_ERRORS.has(code);
}
