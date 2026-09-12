import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApiGatewayWeights, ApiProfileConfig } from '@nau/domain';
import {
  ADAPTIVE_RETRYABLE_ERRORS,
  DEFAULT_GATEWAY_POLICY,
  deriveTrustGroup,
  isAdaptiveRetryable,
  normalizeProfileConfig,
  normalizeWeights,
  parseGatewayPolicy,
  scoreCandidates,
  type GatewayCandidateInput,
} from '../apps/api/src/adaptive-gateway.js';

const only = (component: keyof ApiGatewayWeights): ApiGatewayWeights => ({
  reliability: component === 'reliability' ? 1 : 0,
  latency: component === 'latency' ? 1 : 0,
  cost: component === 'cost' ? 1 : 0,
  load: component === 'load' ? 1 : 0,
  quality: component === 'quality' ? 1 : 0,
});

const candidate = (
  providerId: string,
  overrides: Partial<GatewayCandidateInput> = {},
): GatewayCandidateInput => ({
  providerId,
  state: {
    successCount: 10,
    failureCount: 2,
    consecutiveFailures: 0,
    ewmaLatencyMs: 1_000,
    ewmaFirstTokenMs: 300,
    openUntil: null,
  },
  expectedCostUsd: 0.01,
  activeLeases: 0,
  maxConcurrent: 4,
  qualityScore: 70,
  ...overrides,
});

function scoreById(candidates: GatewayCandidateInput[], weights: ApiGatewayWeights) {
  return new Map(scoreCandidates(candidates, weights).map((result) => [result.providerId, result]));
}

test('gateway policy defaults are copied and custom weights are normalized', () => {
  const first = parseGatewayPolicy(undefined);
  const second = parseGatewayPolicy(null);

  assert.deepEqual(first, DEFAULT_GATEWAY_POLICY);
  assert.deepEqual(second, DEFAULT_GATEWAY_POLICY);
  assert.notEqual(first, DEFAULT_GATEWAY_POLICY);
  assert.notEqual(first.weights, DEFAULT_GATEWAY_POLICY.weights);

  first.weights.quality = 999;
  assert.equal(second.weights.quality, 0.2);
  assert.equal(DEFAULT_GATEWAY_POLICY.weights.quality, 0.2);

  const parsed = parseGatewayPolicy({
    ...DEFAULT_GATEWAY_POLICY,
    mode: 'active',
    weights: { reliability: 4, latency: 3, cost: 2, load: 0, quality: 1 },
  });
  assert.deepEqual(parsed.weights, {
    reliability: 0.4,
    latency: 0.3,
    cost: 0.2,
    load: 0,
    quality: 0.1,
  });
  assert.ok(
    Math.abs(Object.values(parsed.weights).reduce((sum, value) => sum + value, 0) - 1) < 1e-12,
  );
});

test('gateway policy rejects unknown fields and unsafe bounds', () => {
  assert.throws(() => parseGatewayPolicy({ ...DEFAULT_GATEWAY_POLICY, mode: 'automatic' }));
  assert.throws(() => parseGatewayPolicy({ ...DEFAULT_GATEWAY_POLICY, maxAttempts: 4 }));
  assert.throws(() => parseGatewayPolicy({ ...DEFAULT_GATEWAY_POLICY, totalDeadlineMs: 4_999 }));
  assert.throws(() => parseGatewayPolicy({ ...DEFAULT_GATEWAY_POLICY, explorationRate: 0.251 }));
  assert.throws(() => parseGatewayPolicy({ ...DEFAULT_GATEWAY_POLICY, unrecognized: true }));
  assert.throws(() =>
    parseGatewayPolicy({
      ...DEFAULT_GATEWAY_POLICY,
      weights: { ...DEFAULT_GATEWAY_POLICY.weights, reliability: -1 },
    }),
  );
});

test('zero weights fall back to the documented defaults', () => {
  const normalized = normalizeWeights({
    reliability: 0,
    latency: 0,
    cost: 0,
    load: 0,
    quality: 0,
  });
  assert.deepEqual(normalized, DEFAULT_GATEWAY_POLICY.weights);
  assert.notEqual(normalized, DEFAULT_GATEWAY_POLICY.weights);
});

test('new profiles deny personal data by default and receive a stable trust group', () => {
  const legacy: ApiProfileConfig = {
    name: 'Legacy provider',
    preset: 'compatible',
    baseUrl: 'https://API.Example.COM:8443/v1/',
    model: 'legacy-model',
    network: 'cloud',
    auth: 'bearer',
    enabled: true,
    timeoutMs: 30_000,
    maxOutputTokens: 1_000,
    maxConcurrent: 3,
    inputUsdPerMillion: 5,
    outputUsdPerMillion: 30,
    pricesConfirmed: true,
    tokenParameter: 'max_tokens',
    includeUsage: true,
    sendStore: false,
  };

  assert.deepEqual(normalizeProfileConfig(legacy), {
    ...legacy,
    qualityScore: 70,
    allowPersonalData: false,
    trustGroup: 'api.example.com',
  });
  assert.equal(normalizeProfileConfig(legacy, 'profile-123').trustGroup, 'profile-123');
  assert.equal(deriveTrustGroup(legacy.baseUrl), 'api.example.com');
  assert.equal(deriveTrustGroup('not a URL'), '');

  const explicit = normalizeProfileConfig({
    ...legacy,
    qualityScore: 92,
    allowPersonalData: false,
    trustGroup: '  private-nau-boundary  ',
  });
  assert.equal(explicit.qualityScore, 92);
  assert.equal(explicit.allowPersonalData, false);
  assert.equal(explicit.trustGroup, 'private-nau-boundary');
});

test('scorer ranks candidates by each configured signal and keeps component values bounded', () => {
  const reliable = candidate('reliable', {
    state: {
      successCount: 98,
      failureCount: 2,
      consecutiveFailures: 0,
      ewmaLatencyMs: 4_000,
      ewmaFirstTokenMs: 1_000,
      openUntil: null,
    },
  });
  const unreliable = candidate('unreliable', {
    state: {
      successCount: 2,
      failureCount: 98,
      consecutiveFailures: 8,
      ewmaLatencyMs: 200,
      ewmaFirstTokenMs: 50,
      openUntil: null,
    },
  });
  let scores = scoreById([reliable, unreliable], only('reliability'));
  assert.ok(scores.get('reliable')!.score > scores.get('unreliable')!.score);

  const fast = candidate('fast', {
    state: { ...reliable.state, ewmaLatencyMs: 300, ewmaFirstTokenMs: 80 },
  });
  const slow = candidate('slow', {
    state: { ...reliable.state, ewmaLatencyMs: 12_000, ewmaFirstTokenMs: 5_000 },
  });
  scores = scoreById([fast, slow], only('latency'));
  assert.ok(scores.get('fast')!.score > scores.get('slow')!.score);

  scores = scoreById(
    [candidate('cheap', { expectedCostUsd: 0 }), candidate('expensive', { expectedCostUsd: 1 })],
    only('cost'),
  );
  assert.ok(scores.get('cheap')!.score > scores.get('expensive')!.score);

  scores = scoreById(
    [
      candidate('idle', { activeLeases: 0, maxConcurrent: 4 }),
      candidate('saturated', { activeLeases: 9, maxConcurrent: 2 }),
    ],
    only('load'),
  );
  assert.ok(scores.get('idle')!.score > scores.get('saturated')!.score);
  assert.equal(scores.get('saturated')!.components.load, 0);

  scores = scoreById(
    [
      candidate('high-quality', { qualityScore: 120 }),
      candidate('low-quality', { qualityScore: -5 }),
    ],
    only('quality'),
  );
  assert.ok(scores.get('high-quality')!.score > scores.get('low-quality')!.score);
  assert.equal(scores.get('high-quality')!.components.quality, 1);
  assert.equal(scores.get('low-quality')!.components.quality, 0);

  for (const result of scores.values()) {
    assert.equal(result.eligible, true);
    for (const value of Object.values(result.components)) assert.ok(value >= 0 && value <= 1);
  }
});

test('reliability uses a prior so an unobserved provider is neutral instead of perfect', () => {
  const scores = scoreById(
    [
      candidate('unobserved', {
        state: {
          successCount: 0,
          failureCount: 0,
          consecutiveFailures: 0,
          ewmaLatencyMs: null,
          ewmaFirstTokenMs: null,
          openUntil: null,
        },
      }),
      candidate('proven', {
        state: {
          successCount: 80,
          failureCount: 20,
          consecutiveFailures: 0,
          ewmaLatencyMs: 1_000,
          ewmaFirstTokenMs: 200,
          openUntil: null,
        },
      }),
    ],
    only('reliability'),
  );
  assert.equal(scores.get('unobserved')!.components.reliability, 0.5);
  assert.ok(scores.get('proven')!.components.reliability > 0.5);
  assert.ok(scores.get('proven')!.components.reliability < 1);
});

test('adaptive retry taxonomy only permits transient pre-output failures', () => {
  const retryable = [
    'BUSY',
    'CONNECTION_FAILED',
    'COOLDOWN',
    'EMPTY_RESPONSE',
    'RATE_LIMIT',
    'TIMEOUT',
    'UPSTREAM_ERROR',
  ];
  assert.deepEqual([...ADAPTIVE_RETRYABLE_ERRORS].sort(), retryable.sort());
  for (const code of retryable) assert.equal(isAdaptiveRetryable(code), true, code);

  for (const code of [
    'AUTH_FAILED',
    'BUDGET_LIMIT',
    'DISABLED',
    'INCOMPATIBLE_REQUEST',
    'KEY_REQUIRED',
    'LOCAL_ONLY',
    'MODEL_REQUIRED',
    'NOT_FOUND',
    'PRICES_REQUIRED',
    'TEST_REQUIRED',
    'caller_abort',
    '',
  ])
    assert.equal(isAdaptiveRetryable(code), false, code);
});
