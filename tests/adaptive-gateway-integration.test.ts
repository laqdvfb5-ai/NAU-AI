import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { ApiGatewayPolicy, ApiProfile, ApiProfileConfig, LLMRequest } from '@nau/domain';
import { Database } from '../apps/api/src/database.js';
import { Budget } from '../apps/api/src/providers.js';
import { ApiPoolService, DEFAULT_GATEWAY_POLICY, PooledLLM } from '../apps/api/src/api-pool.js';
import { PoolError } from '../apps/api/src/api-pool-security.js';
import { env } from '../apps/api/src/config.js';

type Behavior = 'ok' | 'unavailable' | 'auth' | 'partial-error' | 'hold';

const db = new Database({ memory: true });
const behavior = new Map<string, Behavior>();
const calls = new Map<string, number>();
const heldResponses: ServerResponse[] = [];
let baseUrl = '';
let sequence = 0;
const originalSecret = process.env.SESSION_SECRET;
const originalLimits = { budget: env.budget, maxCost: env.maxCost };

function writeCompletion(res: ServerResponse, model: string) {
  if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(
    `data: ${JSON.stringify({
      id: `fixture-${model}`,
      choices: [{ index: 0, delta: { content: `response-from-${model}` } }],
    })}\n\n`,
  );
  res.write(
    `data: ${JSON.stringify({
      id: `fixture-${model}`,
      choices: [],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
    })}\n\n`,
  );
  res.end('data: [DONE]\n\n');
}

const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const model = String(body.model || 'unknown');
  calls.set(model, (calls.get(model) || 0) + 1);

  switch (behavior.get(model) || 'ok') {
    case 'unavailable':
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'server_error', code: 'service_unavailable' } }));
      return;
    case 'auth':
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'authentication_error', code: 'invalid_api_key' } }));
      return;
    case 'partial-error':
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({
          id: `fixture-${model}`,
          choices: [{ index: 0, delta: { content: 'partial-output' } }],
        })}\n\n`,
      );
      res.end(
        `data: ${JSON.stringify({
          error: { message: 'fixture failure', type: 'server_error', code: 'service_unavailable' },
        })}\n\n`,
      );
      return;
    case 'hold':
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.flushHeaders();
      heldResponses.push(res);
      return;
    default:
      writeCompletion(res, model);
  }
});

before(async () => {
  process.env.SESSION_SECRET = 'adaptive-gateway-isolated-test-secret'.repeat(2);
  env.budget = 20;
  env.maxCost = 0.2;
  await db.initialize();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});

after(async () => {
  for (const res of heldResponses.splice(0)) res.destroy();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.close();
  Object.assign(env, originalLimits);
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
});

function profileConfig(model: string, options: Partial<ApiProfileConfig> = {}): ApiProfileConfig {
  return {
    name: `Adaptive ${model}`,
    preset: 'compatible',
    baseUrl,
    model,
    network: 'local',
    auth: 'none',
    enabled: true,
    timeoutMs: 2_000,
    maxOutputTokens: 64,
    maxConcurrent: 2,
    inputUsdPerMillion: 0,
    outputUsdPerMillion: 0,
    pricesConfirmed: true,
    tokenParameter: 'max_tokens',
    includeUsage: true,
    sendStore: false,
    qualityScore: 50,
    allowPersonalData: true,
    trustGroup: 'test-boundary',
    ...options,
  };
}

async function readyProvider(
  pool: ApiPoolService,
  label: string,
  options: Partial<ApiProfileConfig> = {},
): Promise<ApiProfile> {
  const model = `adaptive-${label}-${++sequence}`;
  behavior.set(model, 'ok');
  const profile = await pool.save(profileConfig(model, options), 'adaptive-test');
  const result = await pool.test(profile.id, 'Kiem tra ket noi', 'adaptive-test');
  assert.equal(result.ok, true, result.message);
  calls.set(model, 0);
  return profile;
}

function activePolicy(overrides: Partial<ApiGatewayPolicy> = {}): ApiGatewayPolicy {
  return {
    ...DEFAULT_GATEWAY_POLICY,
    mode: 'active',
    maxAttempts: 2,
    explorationRate: 0,
    probeIntervalMinutes: 0,
    weights: { reliability: 0, latency: 0, cost: 0, load: 0, quality: 1 },
    ...overrides,
  };
}

async function configureActive(
  pool: ApiPoolService,
  profiles: ApiProfile[],
  policy: ApiGatewayPolicy = activePolicy(),
) {
  await pool.setConfiguration(
    {
      routing: {
        enabled: true,
        strategy: 'manual',
        simple: profiles.map((profile) => profile.id),
        complex: profiles.map((profile) => profile.id),
      },
      policy,
    },
    'adaptive-test',
  );
}

const request = (requestId: string, overrides: Partial<LLMRequest> = {}): LLMRequest => ({
  requestId,
  question: 'Fixture adaptive gateway',
  evidence: 'Du lieu gia chi dung cho kiem thu.',
  complex: false,
  sensitivity: 'public',
  ...overrides,
});

function expectPoolCode(code: string) {
  return (error: unknown) => error instanceof PoolError && error.code === code;
}

test('active mode retries a 503 before output and completes through provider B', async () => {
  const pool = new ApiPoolService(db, new Budget(db));
  const a = await readyProvider(pool, 'failover-a', { qualityScore: 100 });
  const b = await readyProvider(pool, 'failover-b', { qualityScore: 0 });
  await configureActive(pool, [a, b]);
  behavior.set(a.model, 'unavailable');
  const requestId = `failover-${sequence}`;

  const result = await pool.generate(request(requestId));

  assert.equal(result.providerId, b.id);
  assert.equal(calls.get(a.model), 1);
  assert.equal(calls.get(b.model), 1);
  const attempts = await db.query<{
    provider_id: string;
    attempt_no: number;
    status: string;
    error_code: string | null;
    retryable: boolean | null;
    committed: boolean;
  }>(
    'SELECT provider_id,attempt_no,status,error_code,retryable,committed FROM gateway_attempts WHERE request_id=$1 ORDER BY attempt_no',
    [requestId],
  );
  assert.deepEqual(attempts, [
    {
      provider_id: a.id,
      attempt_no: 1,
      status: 'failed',
      error_code: 'UPSTREAM_ERROR',
      retryable: true,
      committed: false,
    },
    {
      provider_id: b.id,
      attempt_no: 2,
      status: 'completed',
      error_code: null,
      retryable: null,
      committed: true,
    },
  ]);
});

test('a partial upstream delta prevents retry even when no onText callback exists', async () => {
  const pool = new ApiPoolService(db, new Budget(db));
  const a = await readyProvider(pool, 'partial-a', { qualityScore: 100 });
  const b = await readyProvider(pool, 'partial-b', { qualityScore: 0 });
  await configureActive(pool, [a, b]);
  behavior.set(a.model, 'partial-error');
  const requestId = `partial-${sequence}`;

  await assert.rejects(pool.generate(request(requestId)), expectPoolCode('UPSTREAM_ERROR'));

  assert.equal(calls.get(a.model), 1);
  assert.equal(calls.get(b.model), 0);
  const attempts = await db.query<{
    provider_id: string;
    attempt_no: number;
    committed: boolean;
  }>(
    'SELECT provider_id,attempt_no,committed FROM gateway_attempts WHERE request_id=$1 ORDER BY attempt_no',
    [requestId],
  );
  assert.deepEqual(attempts, [{ provider_id: a.id, attempt_no: 1, committed: true }]);
});

test('authentication errors are definitive and never sent to the next provider', async () => {
  const pool = new ApiPoolService(db, new Budget(db));
  const a = await readyProvider(pool, 'auth-a', { qualityScore: 100 });
  const b = await readyProvider(pool, 'auth-b', { qualityScore: 0 });
  await configureActive(pool, [a, b]);
  behavior.set(a.model, 'auth');
  const requestId = `auth-${sequence}`;

  await assert.rejects(pool.generate(request(requestId)), expectPoolCode('AUTH_FAILED'));

  assert.equal(calls.get(a.model), 1);
  assert.equal(calls.get(b.model), 0);
  const attempts = await db.query<{ retryable: boolean; error_code: string }>(
    'SELECT retryable,error_code FROM gateway_attempts WHERE request_id=$1',
    [requestId],
  );
  assert.deepEqual(attempts, [{ retryable: false, error_code: 'AUTH_FAILED' }]);
});

test('personal evidence cannot fail over across trust groups', async () => {
  const pool = new ApiPoolService(db, new Budget(db));
  const a = await readyProvider(pool, 'personal-a', {
    qualityScore: 100,
    trustGroup: 'student-boundary-a',
  });
  const b = await readyProvider(pool, 'personal-b', {
    qualityScore: 0,
    trustGroup: 'student-boundary-b',
  });
  await configureActive(pool, [a, b]);
  behavior.set(a.model, 'unavailable');
  const requestId = `personal-${sequence}`;

  await assert.rejects(
    pool.generate(request(requestId, { sensitivity: 'personal' })),
    expectPoolCode('UPSTREAM_ERROR'),
  );

  assert.equal(calls.get(a.model), 1);
  assert.equal(calls.get(b.model), 0);
  const attempts = await db.query<{ provider_id: string }>(
    'SELECT provider_id FROM gateway_attempts WHERE request_id=$1',
    [requestId],
  );
  assert.deepEqual(attempts, [{ provider_id: a.id }]);
});

test('an open circuit persists across ApiPoolService instances', async () => {
  const first = new ApiPoolService(db, new Budget(db));
  const a = await readyProvider(first, 'circuit-a', { qualityScore: 100 });
  const b = await readyProvider(first, 'circuit-b', { qualityScore: 0 });
  await configureActive(first, [a, b], activePolicy({ failureThreshold: 1, cooldownSeconds: 60 }));
  behavior.set(a.model, 'unavailable');

  assert.equal((await first.generate(request(`circuit-open-${sequence}`))).providerId, b.id);
  assert.equal(calls.get(a.model), 1);
  const [state] = await db.query<{
    circuit_state: string;
    circuit_open_until: Date | string | null;
  }>(
    'SELECT circuit_state,circuit_open_until FROM provider_gateway_state WHERE provider_id=$1 AND revision=$2',
    [a.id, a.revision],
  );
  assert.equal(state.circuit_state, 'open');
  assert.ok(state.circuit_open_until);

  const restarted = new ApiPoolService(db, new Budget(db));
  await restarted.refresh();
  assert.equal((await restarted.generate(request(`circuit-restart-${sequence}`))).providerId, b.id);
  assert.equal(calls.get(a.model), 1);
  assert.equal(calls.get(b.model), 2);
});

test('provider concurrency lease is shared by independent service instances', async () => {
  const first = new ApiPoolService(db, new Budget(db));
  const provider = await readyProvider(first, 'lease', {
    qualityScore: 100,
    maxConcurrent: 1,
    timeoutMs: 2_000,
  });
  await configureActive(first, [provider]);
  behavior.set(provider.model, 'hold');
  const second = new ApiPoolService(db, new Budget(db));
  await second.refresh();

  const pending = first.generate(request(`lease-first-${sequence}`));
  const deadline = Date.now() + 2_000;
  while (!heldResponses.length && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(heldResponses.length, 1, 'first service did not reach the fixture');

  await assert.rejects(
    second.generate(request(`lease-second-${sequence}`)),
    expectPoolCode('BUSY'),
  );
  assert.equal(calls.get(provider.model), 1);

  const held = heldResponses.shift()!;
  writeCompletion(held, provider.model);
  assert.equal((await pending).providerId, provider.id);
  const [{ count }] = await db.query<{ count: string }>(
    'SELECT count(*) AS count FROM provider_gateway_leases WHERE provider_id=$1 AND expires_at>now()',
    [provider.id],
  );
  assert.equal(Number(count), 0);
});

test('off and shadow preserve provider timeout while active uses the gateway deadline', async () => {
  const pool = new ApiPoolService(db, new Budget(db));
  const provider = await readyProvider(pool, 'deadline', { timeoutMs: 120_000 });
  const invoke = (pool as any).invoke;
  const captured: number[] = [];
  (pool as any).invoke = async (
    _row: unknown,
    _request: unknown,
    _purpose: unknown,
    attempt: { deadlineAt: number },
  ) => {
    captured.push(attempt.deadlineAt - Date.now());
    return {
      text: 'fixture',
      model: provider.model,
      providerId: provider.id,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
    };
  };
  try {
    for (const mode of ['off', 'shadow'] as const) {
      await pool.setConfiguration(
        {
          routing: {
            enabled: true,
            strategy: 'manual',
            simple: [provider.id],
            complex: [provider.id],
          },
          policy: { ...activePolicy({ totalDeadlineMs: 5_000 }), mode },
        },
        'adaptive-test',
      );
      await pool.generate(request(`deadline-${mode}-${sequence}`));
    }
    await configureActive(pool, [provider], activePolicy({ totalDeadlineMs: 5_000 }));
    await pool.generate(request(`deadline-active-${sequence}`));
  } finally {
    (pool as any).invoke = invoke;
  }
  assert.ok(captured[0] > 110_000, `off deadline was ${captured[0]}ms`);
  assert.ok(captured[1] > 110_000, `shadow deadline was ${captured[1]}ms`);
  assert.ok(captured[2] > 4_000 && captured[2] <= 5_000, `active deadline was ${captured[2]}ms`);
});

test('PooledLLM refreshes routing before every fallback decision', async () => {
  const admin = new ApiPoolService(db, new Budget(db));
  const provider = await readyProvider(admin, 'routing-refresh');
  await configureActive(admin, [provider]);
  const replica = new ApiPoolService(db, new Budget(db));
  let fallbackCalls = 0;
  const llm = new PooledLLM(replica, {
    mode: 'fixture-fallback',
    async generate() {
      fallbackCalls++;
      return {
        text: 'fallback',
        model: 'fixture-fallback',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      };
    },
  });

  assert.equal(
    (await llm.generate(request(`routing-enabled-${sequence}`))).providerId,
    provider.id,
  );
  assert.equal(fallbackCalls, 0);
  await admin.setConfiguration(
    {
      routing: { enabled: false, strategy: 'manual', simple: [], complex: [] },
      policy: activePolicy(),
    },
    'adaptive-test',
  );
  assert.equal(
    (await llm.generate(request(`routing-disabled-${sequence}`))).model,
    'fixture-fallback',
  );
  assert.equal(fallbackCalls, 1);
});

test('probe auth failure revokes readiness without training chat reliability', async () => {
  const pool = new ApiPoolService(db, new Budget(db));
  const provider = await readyProvider(pool, 'probe-auth');
  await pool.setConfiguration(
    {
      routing: {
        enabled: true,
        strategy: 'manual',
        simple: [provider.id],
        complex: [provider.id],
      },
      policy: { ...activePolicy(), mode: 'shadow', probeIntervalMinutes: 1 },
    },
    'adaptive-test',
  );
  behavior.set(provider.model, 'auth');
  await pool.runHealthProbes();
  behavior.set(provider.model, 'ok');

  assert.equal((await pool.list()).find((item) => item.id === provider.id)?.ready, false);
  const [state] = await db.query<{ success_count: string; failure_count: string }>(
    'SELECT success_count,failure_count FROM provider_gateway_state WHERE provider_id=$1 AND revision=$2',
    [provider.id, provider.revision],
  );
  assert.equal(Number(state.success_count), 0);
  assert.equal(Number(state.failure_count), 0);
});

test('application stream callback failures do not fail over or penalize a provider', async () => {
  const pool = new ApiPoolService(db, new Budget(db));
  const a = await readyProvider(pool, 'callback-a', { qualityScore: 100 });
  const b = await readyProvider(pool, 'callback-b', { qualityScore: 0 });
  await configureActive(pool, [a, b]);

  await assert.rejects(
    pool.generate(
      request(`callback-${sequence}`, {
        onText() {
          throw new Error('fixture client disconnected');
        },
      }),
    ),
    expectPoolCode('CALLBACK_FAILED'),
  );
  assert.equal(calls.get(a.model), 1);
  assert.equal(calls.get(b.model), 0);
  const [state] = await db.query<{ failure_count: string }>(
    'SELECT failure_count FROM provider_gateway_state WHERE provider_id=$1 AND revision=$2',
    [a.id, a.revision],
  );
  assert.equal(Number(state.failure_count), 0);
});

test('feedback updates a quality posterior and changes later provider selection', async () => {
  const pool = new ApiPoolService(db, new Budget(db));
  const a = await readyProvider(pool, 'reward-a', { qualityScore: 50 });
  const b = await readyProvider(pool, 'reward-b', { qualityScore: 50 });
  await configureActive(pool, [a, b]);
  const firstRequest = `reward-first-${sequence}`;
  assert.equal((await pool.generate(request(firstRequest))).providerId, a.id);

  const conversationId = randomUUID();
  await db.query(
    'INSERT INTO feedback(id,conversation_id,message_id,rating,note) VALUES($1,$2,$3,-1,$4)',
    [randomUUID(), conversationId, firstRequest, 'fixture'],
  );
  assert.deepEqual(await pool.recordFeedback(firstRequest), { learned: true });
  const [negativeState] = await db.query<{ quality_ewma: string }>(
    'SELECT quality_ewma FROM provider_gateway_state WHERE provider_id=$1 AND revision=$2',
    [a.id, a.revision],
  );
  assert.equal(Number(negativeState.quality_ewma), 3 / 7);
  assert.equal(
    (await pool.generate(request(`reward-after-negative-${sequence}`))).providerId,
    b.id,
  );

  await db.query('UPDATE feedback SET rating=1 WHERE conversation_id=$1 AND message_id=$2', [
    conversationId,
    firstRequest,
  ]);
  await pool.recordFeedback(firstRequest);
  const [positiveState] = await db.query<{ quality_ewma: string }>(
    'SELECT quality_ewma FROM provider_gateway_state WHERE provider_id=$1 AND revision=$2',
    [a.id, a.revision],
  );
  assert.equal(Number(positiveState.quality_ewma), 4 / 7);
  assert.equal(
    (await pool.generate(request(`reward-after-positive-${sequence}`))).providerId,
    a.id,
  );
});
