import { spawn } from 'node:child_process';
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { once } from 'node:events';
import { createServer } from 'node:http';
import '../apps/api/src/config.js';
const reports: Record<string, unknown>[] = [];
await mkdir('reports', { recursive: true });
await mkdir('.data', { recursive: true });
const counts = (process.argv.find((x) => x.startsWith('--counts='))?.slice(9) || '120,3000')
  .split(',')
  .map(Number);
const requests = Number(process.argv.find((x) => x.startsWith('--requests='))?.slice(11) || 100);
if (
  counts.some((n) => ![120, 3000].includes(n)) ||
  !Number.isInteger(requests) ||
  requests < 1 ||
  requests > 1000
)
  throw new Error('Use counts=120,3000 and requests=1..1000');
for (const count of counts) {
  // Isolated HTTP model fixture for service throughput, never a real-model benchmark.
  const modelServer = createServer(async (req, res) => {
    for await (const _chunk of req) {
      /* consume request */
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Phản hồi từ model giả lập kiểm thử tải.' }, finish_reason: 'stop' }] })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } })}\n\n`,
    );
    res.end('data: [DONE]\n\n');
  });
  modelServer.listen(0, '127.0.0.1');
  await once(modelServer, 'listening');
  const port = 4200 + (count === 3000 ? 1 : 0),
    base = `http://127.0.0.1:${port}/api/v1`,
    data = await mkdtemp(resolve('.data', 'load-' + count + '-'));
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: resolve('apps/api'),
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: '',
      REDIS_URL: '',
      DATA_DIR: data,
      SEED_COUNT: String(count),
      DATA_MODE: 'synthetic',
      ALLOW_DEMO_LOGIN: 'true',
      LLM_PROVIDER: 'local',
      LOCAL_LLM_URL: `http://127.0.0.1:${(modelServer.address() as { port: number }).port}/v1`,
      LOCAL_LLM_MODEL: 'load-test-fixture',
      EMBEDDING_PROVIDER: 'none',
      CHAT_RATE_LIMIT: '10000',
      NODE_ENV: 'test',
      WEB_ORIGIN: 'http://localhost:3000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (d) => {
    output = (output + d).slice(-6000);
  });
  child.stderr?.on('data', (d) => {
    output = (output + d).slice(-6000);
  });
  try {
    let ready = false;
    for (let n = 0; n < 100; n++) {
      try {
        const r = await fetch(base + '/health', { signal: AbortSignal.timeout(1000) });
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      if (child.exitCode !== null) throw new Error('Load API failed: ' + output);
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!ready) throw new Error('Load API did not start: ' + output);
    const login = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'sv007', password: process.env.DEMO_PASSWORD }),
    });
    if (!login.ok) throw new Error('Load login failed');
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    for (const concurrency of [10, 25, 50]) {
      const latencies: number[] = [];
      let cursor = 0,
        errors = 0;
      const started = performance.now();
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (cursor < requests) {
            const i = cursor++;
            const start = performance.now();
            try {
              const r = await fetch(base + '/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Cookie: cookie },
                body: JSON.stringify({
                  message: i % 2 ? 'Giải thích điểm của tôi' : 'Điều kiện dự thi theo quy chế 2025',
                }),
                signal: AbortSignal.timeout(30000),
              });
              const body = await r.text();
              if (!r.ok || !body.includes('event: answer') || body.includes('event: error'))
                errors++;
            } catch {
              errors++;
            }
            latencies.push(performance.now() - start);
          }
        }),
      );
      latencies.sort((a, b) => a - b);
      const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1];
      const row = {
        profileCount: count,
        concurrency,
        requests,
        errors,
        errorPercent: (100 * errors) / requests,
        p50Ms: Math.round(latencies[Math.floor(latencies.length * 0.5)]),
        p95Ms: Math.round(p95),
        durationMs: Math.round(performance.now() - started),
        meetsPilotTarget: errors / requests < 0.01 && p95 < 30000,
        mode: 'http_model_fixture',
        storage: 'embedded PostgreSQL',
        rateLimit: 'raised to isolate service throughput in this synthetic-only process',
        liveModel: false,
      };
      reports.push(row);
      console.log(JSON.stringify(row));
    }
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null)
      await Promise.race([once(child, 'exit'), new Promise((r) => setTimeout(r, 5000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
    modelServer.closeAllConnections();
    await new Promise<void>((resolve) => modelServer.close(() => resolve()));
  }
}
await writeFile(
  'reports/load.json',
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      environment: { platform: process.platform, node: process.version },
      limitations:
        'Local synthetic data, isolated HTTP model fixture, no real model latency or cost. Benchmark again on VPS with PostgreSQL/Redis and configured real model before pilot.',
      results: reports,
    },
    null,
    2,
  ),
);
if (reports.some((r) => !r.meetsPilotTarget)) process.exitCode = 1;
