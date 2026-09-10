import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { ApiProfileConfig, ApiProfile } from '@nau/domain';
import { Database } from '../apps/api/src/database.js';
import { Budget, EvidenceProvider } from '../apps/api/src/providers.js';
import { ApiPoolService, PooledLLM } from '../apps/api/src/api-pool.js';
import {
  checkApiAddress,
  validateApiBaseUrl,
  createApiTransport,
  encryptApiKey,
  decryptApiKey,
  PoolError,
} from '../apps/api/src/api-pool-security.js';
import { env } from '../apps/api/src/config.js';
import { MODEL_SYSTEM_PROMPT } from '../apps/api/src/dialogue.js';

const db = new Database({ memory: true });
const pool = new ApiPoolService(db, new Budget(db));
const originalSecret = process.env.SESSION_SECRET;
const originalLimits = { budget: env.budget, maxCost: env.maxCost };
const seen: { url: string; auth?: string; body: any }[] = [];
let baseUrl = '';
let behavior: 'ok' | 'auth' | 'empty' | 'no-usage' | 'hang' = 'ok';
const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  seen.push({ url: req.url || '', auth: req.headers.authorization, body });
  if (req.url === '/v1/redirect') {
    res.writeHead(302, { Location: baseUrl + '/leaked' });
    res.end();
    return;
  }
  if (req.url === '/v1/models') {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        object: 'list',
        data: [{ id: 'fixture-model', owned_by: 'test-only', object: 'model' }],
      }),
    );
    return;
  }
  if (behavior === 'auth') {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: {
          message: 'never expose fixture-secret-key or upstream response',
          type: 'authentication_error',
        },
      }),
    );
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.flushHeaders();
  if (behavior === 'hang') return;
  if (behavior !== 'empty')
    for (const content of ['DỮ LIỆU GIẢ: ', 'Điểm 6,2 nhưng PI2.1 là F nên chưa đạt.']) {
      res.write(
        `data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { content } }] })}\n\n`,
      );
    }
  if (behavior !== 'no-usage')
    res.write(
      `data: ${JSON.stringify({ id: 'fixture', choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\n`,
    );
  res.end('data: [DONE]\n\n');
});
before(async () => {
  process.env.SESSION_SECRET = 'fixture-pool-secret-only-for-isolated-unit-tests';
  env.budget = 20;
  env.maxCost = 0.2;
  await db.initialize();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.close();
  Object.assign(env, originalLimits);
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
});
const config = (overrides: Partial<ApiProfileConfig> = {}): ApiProfileConfig => ({
  name: 'Fixture only',
  preset: 'compatible',
  baseUrl,
  model: 'fixture-model',
  network: 'local',
  auth: 'none',
  enabled: true,
  timeoutMs: 2000,
  maxOutputTokens: 100,
  maxConcurrent: 2,
  inputUsdPerMillion: 1,
  outputUsdPerMillion: 2,
  pricesConfirmed: true,
  tokenParameter: 'max_tokens',
  includeUsage: true,
  sendStore: false,
  ...overrides,
});
function editable(profile: ApiProfile) {
  const {
    id,
    revision,
    hasKey,
    ready,
    lastTest,
    createdAt,
    updatedAt,
    inFlight,
    cooldownUntil,
    ...fields
  } = profile;
  return { ...fields, revision };
}
const request = {
  question: 'Vì sao chưa đạt?',
  evidence: 'Dữ liệu giả: 6,2; PI F.',
  complex: false,
};
const isCode = (code: string) => (error: unknown) =>
  error instanceof PoolError && error.code === code;
function assertSharedSystemMessage(body: any) {
  assert.ok(Array.isArray(body.messages));
  const systemMessages = body.messages.filter((message: any) => message.role === 'system');
  assert.equal(systemMessages.length, 1);
  assert.equal(systemMessages[0].content, MODEL_SYSTEM_PROMPT);
  for (const marker of [
    'NAU AI',
    'Trường Đại học Nghệ An',
    'K12A3',
    'Lê Anh Quốc',
    'Nguyễn Văn Thương',
  ])
    assert.match(systemMessages[0].content, new RegExp(marker));
}

test('API base URL and address checks block credentials, metadata, public/local mixing and redirects', async () => {
  for (const value of [
    'https://user:pass@example.com/v1',
    'https://example.com/v1?key=secret',
    'file:///tmp/x',
    'https://example.com/v1/models',
  ])
    assert.throws(() => validateApiBaseUrl(value, 'cloud'));
  assert.throws(
    () => validateApiBaseUrl('http://example.com/v1', 'cloud'),
    isCode('HTTPS_REQUIRED'),
  );
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1'])
    assert.throws(() => checkApiAddress(ip, 'cloud'));
  for (const ip of ['8.8.8.8', '169.254.169.254', '0.0.0.0'])
    assert.throws(() => checkApiAddress(ip, 'local'));
  checkApiAddress('127.0.0.1', 'local');
  checkApiAddress('192.168.1.1', 'local');
  checkApiAddress('8.8.8.8', 'cloud');
  const transport = createApiTransport(baseUrl, 'local');
  try {
    await assert.rejects(
      transport.fetch(baseUrl + '/redirect', {
        headers: { Authorization: 'Bearer fixture-secret-key' },
      }),
    );
    assert.equal(seen.filter((r) => r.url.endsWith('/leaked')).length, 0);
    await assert.rejects(
      transport.fetch('https://example.com/v1/models'),
      isCode('NETWORK_BLOCKED'),
    );
    await assert.rejects(
      transport.fetch(baseUrl.replace('/v1', '/other/models')),
      isCode('NETWORK_BLOCKED'),
    );
  } finally {
    await transport.close();
  }
  const cloud = createApiTransport('https://127.0.0.1/v1', 'cloud');
  try {
    await assert.rejects(cloud.fetch('https://127.0.0.1/v1/models'), isCode('NETWORK_BLOCKED'));
  } finally {
    await cloud.close();
  }
});

test('encrypted API keys bind to profile and server secret; public output never reveals key', async () => {
  const secret = 'test-server-secret-'.repeat(3);
  const cipher = encryptApiKey('fixture-secret-key', 'profile-a', secret);
  assert.ok(!cipher.includes('fixture-secret-key'));
  assert.equal(decryptApiKey(cipher, 'profile-a', secret), 'fixture-secret-key');
  assert.throws(() => decryptApiKey(cipher, 'profile-b', secret), isCode('KEY_STORAGE'));
  assert.throws(() => decryptApiKey(cipher, 'profile-a', secret + 'x'), isCode('KEY_STORAGE'));
  const p = await pool.save(
    { ...config({ auth: 'bearer' }), apiKey: 'fixture-secret-key' },
    'admin-test',
  );
  assert.equal(p.hasKey, true);
  const [row] = await db.query('SELECT encrypted_key FROM api_profiles WHERE id=$1', [p.id]);
  assert.ok(row.encrypted_key.startsWith('v1.'));
  assert.ok(!JSON.stringify(await pool.overview()).includes('fixture-secret-key'));
  assert.ok(!JSON.stringify(await pool.list()).includes(row.encrypted_key));
  const updated = await pool.save(editable(p), 'admin-test', p.id);
  assert.equal(updated.hasKey, true);
  await assert.rejects(
    pool.save({ ...editable(updated), baseUrl: 'http://127.0.0.1:12345/v1' }, 'admin-test', p.id),
    isCode('REENTER_KEY'),
  );
  await assert.rejects(pool.save(editable(p), 'admin-test', p.id), isCode('STALE_PROFILE'));
  await pool.models(p.id, 'admin-test');
  assert.equal(seen.at(-1)?.auth, 'Bearer fixture-secret-key');
  const cleared = await pool.save({ ...editable(updated), clearKey: true }, 'admin-test', p.id);
  assert.equal(cleared.hasKey, false);
  assert.equal((await pool.test(p.id, request.question, 'admin-test')).errorCode, 'KEY_REQUIRED');
});

test('draft can discover models without model ID; test streams actual HTTP and records provider usage', async () => {
  const draft = await pool.save(config({ model: '' }), 'admin-test');
  assert.equal(
    (await pool.test(draft.id, request.question, 'admin-test')).errorCode,
    'MODEL_REQUIRED',
  );
  const models = await pool.models(draft.id, 'admin-test');
  assert.deepEqual(models.models, [{ id: 'fixture-model', ownedBy: 'test-only' }]);
  assert.equal(seen.at(-1)?.auth, undefined);
  const p = await pool.save(
    { ...editable(draft), model: models.models[0].id, sendStore: true },
    'admin-test',
    draft.id,
  );
  const deltas: string[] = [];
  const result = await pool.test(p.id, request.question, 'admin-test', undefined, (t) =>
    deltas.push(t),
  );
  assert.equal(result.ok, true, result.message);
  assert.equal(deltas.join(''), result.reply);
  assert.ok(deltas.length > 1);
  assert.ok(result.firstTokenMs! >= 0);
  assert.equal(result.inputTokens, 100);
  assert.equal(result.outputTokens, 20);
  assert.equal(result.costUsd, 0.00014);
  assert.equal(result.usageEstimated, false);
  assert.equal(seen.at(-1)?.body.max_tokens, 100);
  assert.equal(seen.at(-1)?.body.store, false);
  assert.equal(seen.at(-1)?.body.stream_options.include_usage, true);
  assertSharedSystemMessage(seen.at(-1)?.body);
  assert.ok(!('tools' in seen.at(-1)!.body));
  const [usage] = await db.query('SELECT * FROM usage WHERE provider_id=$1', [p.id]);
  assert.equal(usage.purpose, 'test');
  assert.equal(usage.status, 'completed');
  assert.equal(Number(usage.input_tokens), 100);
  const stored = (await pool.list()).find((v) => v.id === p.id)!;
  assert.equal(stored.ready, true);
  assert.equal(stored.lastTest?.ok, true);
  assert.equal(stored.lastTest?.reply, undefined);
});

test('routing requires successful test at current revision and survives service restart', async () => {
  const p = await pool.save(config(), 'admin-test');
  const routing = { enabled: true, strategy: 'manual', simple: [p.id], complex: [p.id] };
  await assert.rejects(pool.setRouting(routing, 'admin-test'), isCode('TEST_REQUIRED'));
  assert.equal((await pool.test(p.id, request.question, 'admin-test')).ok, true);
  await pool.setRouting(routing, 'admin-test');
  const restarted = new ApiPoolService(db, new Budget(db));
  const llm = new PooledLLM(restarted, new EvidenceProvider());
  await llm.refresh();
  assert.equal(llm.mode, 'pool');
  assert.equal((await llm.generate(request)).providerId, p.id);
  await assert.rejects(pool.remove(p.id, 'admin-test'), isCode('IN_USE'));
  await pool.save({ ...editable(p), model: 'fixture-changed' }, 'admin-test', p.id);
  await assert.rejects(restarted.generate(request), isCode('TEST_REQUIRED'));
  await pool.setRouting({ ...routing, enabled: false, simple: [], complex: [] }, 'admin-test');
  await llm.refresh();
  assert.equal(llm.mode, 'evidence');
  await assert.rejects(llm.generate(request));
  await pool.remove(p.id, 'admin-test');
});

test('a transient failed test preserves readiness until the profile configuration changes', async () => {
  const p = await pool.save(config(), 'admin-test');
  const routing = { enabled: true, strategy: 'manual', simple: [p.id], complex: [p.id] };
  assert.equal(p.ready, false);
  assert.equal((await pool.test(p.id, request.question, 'admin-test')).ok, true);
  assert.equal((await pool.list()).find((v) => v.id === p.id)?.ready, true);
  await pool.setRouting(routing, 'admin-test');

  try {
    behavior = 'auth';
    const failed = await pool.test(p.id, request.question, 'admin-test');
    assert.equal(failed.ok, false);
    assert.equal(failed.errorCode, 'AUTH_FAILED');
  } finally {
    behavior = 'ok';
  }

  const afterFailure = (await pool.list()).find((v) => v.id === p.id)!;
  assert.equal(afterFailure.lastTest?.ok, false);
  assert.equal(afterFailure.ready, true);
  const restarted = new ApiPoolService(db, new Budget(db));
  const llm = new PooledLLM(restarted, new EvidenceProvider());
  await llm.refresh();
  assert.equal((await llm.generate(request)).providerId, p.id);

  const changed = await pool.save(
    { ...editable(afterFailure), model: 'fixture-changed' },
    'admin-test',
    p.id,
  );
  assert.equal(changed.ready, false);
  await assert.rejects(llm.generate(request), isCode('TEST_REQUIRED'));
  await pool.setRouting({ ...routing, enabled: false, simple: [], complex: [] }, 'admin-test');
});

test('manual lanes and round robin select actual servers; failed call is never resent', async () => {
  const a = await pool.save(config({ name: 'Fixture A', model: 'fixture-a' }), 'admin-test');
  const b = await pool.save(config({ name: 'Fixture B', model: 'fixture-b' }), 'admin-test');
  for (const p of [a, b]) {
    assert.equal((await pool.test(p.id, request.question, 'admin-test')).ok, true);
    assertSharedSystemMessage(seen.at(-1)?.body);
  }
  await pool.setRouting(
    { enabled: true, strategy: 'manual', simple: [a.id], complex: [b.id] },
    'admin-test',
  );
  assert.equal((await pool.generate(request)).providerId, a.id);
  assertSharedSystemMessage(seen.at(-1)?.body);
  assert.equal((await pool.generate({ ...request, complex: true })).providerId, b.id);
  assertSharedSystemMessage(seen.at(-1)?.body);
  await pool.setRouting(
    { enabled: true, strategy: 'round_robin', simple: [a.id, b.id], complex: [a.id, b.id] },
    'admin-test',
  );
  const ids = [];
  for (let i = 0; i < 4; i++) {
    ids.push((await pool.generate(request)).providerId);
    assertSharedSystemMessage(seen.at(-1)?.body);
  }
  assert.deepEqual(ids, [a.id, b.id, a.id, b.id]);
  behavior = 'auth';
  const beforeCalls = seen.length;
  try {
    await assert.rejects(pool.generate(request), isCode('AUTH_FAILED'));
    assert.equal(seen.length - beforeCalls, 1);
    assertSharedSystemMessage(seen.at(-1)?.body);
  } finally {
    behavior = 'ok';
  }
});

test('authentication failure and empty completion cannot produce success or expose upstream body', async () => {
  const p = await pool.save(config(), 'admin-test');
  try {
    behavior = 'auth';
    const bad = await pool.test(p.id, request.question, 'admin-test');
    assert.equal(bad.ok, false);
    assert.equal(bad.errorCode, 'AUTH_FAILED');
    assert.ok(!JSON.stringify(bad).includes('fixture-secret-key'));
    assert.ok(!JSON.stringify(await pool.overview()).includes('upstream response'));
    behavior = 'empty';
    const empty = await pool.test(p.id, request.question, 'admin-test');
    assert.equal(empty.ok, false);
    assert.equal(empty.errorCode, 'EMPTY_RESPONSE');
    const [usage] = await db.query(
      "SELECT count(*) AS count FROM usage WHERE provider_id=$1 AND status LIKE 'pool_error_%'",
      [p.id],
    );
    assert.equal(Number(usage.count), 2);
  } finally {
    behavior = 'ok';
  }
});

test('missing usage keeps explicit cost reservation; unconfirmed prices and low budget block before network', async () => {
  const p = await pool.save(config(), 'admin-test');
  try {
    behavior = 'no-usage';
    const result = await pool.test(p.id, request.question, 'admin-test');
    assert.equal(result.ok, true);
    assert.equal(result.usageEstimated, true);
    assert.ok(result.costUsd! > 0);
  } finally {
    behavior = 'ok';
  }
  const unpriced = await pool.save(config({ pricesConfirmed: false }), 'admin-test');
  const count = seen.length;
  assert.equal(
    (await pool.test(unpriced.id, request.question, 'admin-test')).errorCode,
    'PRICES_REQUIRED',
  );
  const prior = env.maxCost;
  try {
    env.maxCost = 0.0000001;
    assert.equal((await pool.test(p.id, request.question, 'admin-test')).errorCode, 'BUDGET_LIMIT');
  } finally {
    env.maxCost = prior;
  }
  assert.equal(seen.length, count);
});

test('local-only mode blocks external profiles and automatic pool cannot mix network scopes', async () => {
  const local = await pool.save(config(), 'admin-test');
  const cloud = await pool.save(
    {
      ...config({ baseUrl: 'https://api.example.com/v1', network: 'cloud', auth: 'bearer' }),
      apiKey: 'fixture-key',
    },
    'admin-test',
  );
  const previous = env.llm;
  try {
    env.llm = 'local';
    const count = seen.length;
    assert.equal(
      (await pool.test(cloud.id, request.question, 'admin-test')).errorCode,
      'LOCAL_ONLY',
    );
    await assert.rejects(pool.models(cloud.id, 'admin-test'), isCode('LOCAL_ONLY'));
    assert.equal(seen.length, count);
  } finally {
    env.llm = previous;
  }
  await assert.rejects(
    pool.setRouting(
      { enabled: false, strategy: 'round_robin', simple: [local.id], complex: [cloud.id] },
      'admin-test',
    ),
    isCode('MIXED_NETWORK'),
  );
});

test('whole-stream timeout and concurrency cap release slots even after upstream headers', async () => {
  const p = await pool.save(config({ timeoutMs: 1000, maxConcurrent: 1 }), 'admin-test');
  behavior = 'hang';
  try {
    const count = seen.length;
    const first = pool.test(p.id, request.question, 'admin-test');
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 2000;
      const poll = () => {
        if (seen.length > count) resolve();
        else if (Date.now() > deadline) reject(new Error('Fixture was not contacted'));
        else setTimeout(poll, 10);
      };
      poll();
    });
    const second = await pool.test(p.id, request.question, 'admin-test');
    assert.equal(second.errorCode, 'BUSY');
    await assert.rejects(pool.save(editable(p), 'admin-test', p.id), isCode('BUSY'));
    const result = await first;
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, 'TIMEOUT');
    assert.ok(result.latencyMs < 4000);
    assert.equal((await pool.list()).find((v) => v.id === p.id)?.inFlight, 0);
  } finally {
    behavior = 'ok';
  }
  assert.equal((await pool.test(p.id, request.question, 'admin-test')).ok, true);
});
