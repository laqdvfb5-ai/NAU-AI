import { test as base, expect, type APIRequestContext } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';

export const adminPassword =
  readFileSync('.env', 'utf8')
    .match(/^ADMIN_PASSWORD=(.+)$/m)?.[1]
    .trim() || '';
export const MODEL_REPLY =
  'PHẢN HỒI TỪ MODEL KIỂM THỬ: Mình sử dụng căn cứ được cấp trong phiên này.';

type ModelCall = {
  model: string;
  messages: { role: string; content: string }[];
  payload: { question: string; evidence: string; history?: { role: string; content: string }[] };
};
type ResponsePlan = {
  text?: string;
  firstTokenDelayMs?: number;
  finishDelayMs?: number;
  errorStatus?: number;
};
type ModelFixture = {
  calls: ModelCall[];
  respondNext: (response: ResponsePlan) => void;
};
type ModelPool = ModelFixture & { clear: () => void };
const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

export function chatEvents(stream: string) {
  return stream.split(/\r?\n\r?\n/).flatMap((block) => {
    const event = block.match(/^event: (.+)$/m)?.[1];
    const data = block.match(/^data: (.+)$/m)?.[1];
    return event && data ? [{ event, data: JSON.parse(data) }] : [];
  });
}

async function check(response: Awaited<ReturnType<APIRequestContext['post']>>) {
  expect(response.ok()).toBe(true);
  return response;
}

// These browser tests exercise a real HTTP model stream without using a cloud account.
// The original model routing is restored even when a test or fixture setup fails.
export const test = base.extend<{ model: ModelFixture }, { modelPool: ModelPool }>({
  modelPool: [
    async ({ playwright }, use, workerInfo) => {
      const calls: ModelCall[] = [];
      const plans: ResponsePlan[] = [];
      const server = createServer(async (req, res) => {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        if (req.url === '/v1/models') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ data: [{ id: 'fixture-model-only', object: 'model' }] }));
          return;
        }
        const body = JSON.parse(raw);
        let payload: ModelCall['payload'];
        try {
          payload = JSON.parse(body.messages.at(-1).content);
        } catch {
          payload = { question: body.messages.at(-1)?.content || '', evidence: '' };
        }
        calls.push({ ...body, payload });
        const plan = plans.shift() || {};
        if (plan.errorStatus) {
          res.writeHead(plan.errorStatus, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Intentional E2E model failure' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.flushHeaders();
        const content = plan.text ?? MODEL_REPLY;
        const midpoint = Math.ceil(content.length / 2);
        const write = (text: string) => {
          if (!res.destroyed)
            res.write(
              `data: ${JSON.stringify({ id: 'fixture', choices: [{ delta: { content: text } }] })}\n\n`,
            );
        };
        await delay(plan.firstTokenDelayMs);
        write(content.slice(0, midpoint));
        await delay(plan.finishDelayMs);
        write(content.slice(midpoint));
        if (!res.destroyed) {
          res.write(
            `data: ${JSON.stringify({ id: 'fixture', choices: [], usage: { prompt_tokens: 100, completion_tokens: 30 } })}\n\n`,
          );
          res.end('data: [DONE]\n\n');
        }
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const admin = await playwright.request.newContext({
        baseURL: workerInfo.project.use.baseURL as string,
      });
      let profileId = '';
      let originalRouting: unknown;
      try {
        await check(
          await admin.post('/api/v1/auth/login', {
            data: { username: 'admin', password: adminPassword },
          }),
        );
        originalRouting = (await (await check(await admin.get('/api/v1/admin/api-pool'))).json())
          .routing;
        const created = await check(
          await admin.post('/api/v1/admin/api-pool/profiles', {
            data: {
              name: 'Model-only E2E fixture ' + Date.now(),
              preset: 'ollama',
              baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
              model: 'fixture-model-only',
              network: 'local',
              auth: 'none',
              enabled: true,
              timeoutMs: 15000,
              maxOutputTokens: 1200,
              maxConcurrent: 5,
              inputUsdPerMillion: 0,
              outputUsdPerMillion: 0,
              pricesConfirmed: true,
              tokenParameter: 'max_tokens',
              includeUsage: true,
              sendStore: false,
            },
          }),
        );
        profileId = (await created.json()).id;
        const probe = await check(
          await admin.post(`/api/v1/admin/api-pool/profiles/${profileId}/test`, {
            data: { question: 'Verify local browser fixture' },
          }),
        );
        expect(chatEvents(await probe.text()).find((e) => e.event === 'result')?.data.ok).toBe(
          true,
        );
        await check(
          await admin.post('/api/v1/admin/api-pool/routing', {
            data: {
              enabled: true,
              strategy: 'manual',
              simple: [profileId],
              complex: [profileId],
            },
          }),
        );
        await use({
          calls,
          respondNext: (response) => plans.push(response),
          clear: () => {
            calls.length = 0;
            plans.length = 0;
          },
        });
      } finally {
        try {
          if (originalRouting)
            await check(
              await admin.post('/api/v1/admin/api-pool/routing', { data: originalRouting }),
            );
          if (profileId)
            await check(
              await admin.delete('/api/v1/admin/api-pool/profiles/' + profileId, { data: {} }),
            );
        } finally {
          await admin.dispose();
          server.closeAllConnections();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      }
    },
    { scope: 'worker' },
  ],
  model: [
    async ({ modelPool }, use) => {
      modelPool.clear();
      await use(modelPool);
    },
    { auto: true },
  ],
});

export { expect };
