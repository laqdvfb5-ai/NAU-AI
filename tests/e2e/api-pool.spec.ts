import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';

const password =
  readFileSync('.env', 'utf8')
    .match(/^ADMIN_PASSWORD=(.+)$/m)?.[1]
    .trim() || '';

test('admin configures API, discovers model, streams test and uses it in actual chat; mobile and access checks', async ({
  page,
  browser,
}) => {
  page.setDefaultTimeout(10000);
  const calls: any[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (req.url === '/v1/models') {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          data: [{ id: 'fixture-e2e-model', object: 'model', owned_by: 'test-fixture' }],
        }),
      );
      return;
    }
    const body = JSON.parse(raw);
    calls.push(body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(
      `data: ${JSON.stringify({ id: 'fixture', choices: [{ delta: { content: 'PHẢN HỒI TỪ SERVER KIỂM THỬ: PI2.1 là F. ' } }] })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({ id: 'fixture', choices: [{ delta: { content: 'Điểm tổng 6,2 chưa đủ để đạt học phần cốt lõi; xem Điều 12 khoản 4.' } }] })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({ id: 'fixture', choices: [], usage: { prompt_tokens: 100, completion_tokens: 30 } })}\n\n`,
    );
    res.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  let id = '';
  let originalRouting: any;
  try {
    await page.goto('/login');
    await page.getByLabel('Tên đăng nhập', { exact: true }).fill('admin');
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    const overview = await page.request.get('/api/v1/admin/api-pool');
    expect(overview.ok()).toBe(true);
    originalRouting = (await overview.json()).routing;
    await page.getByRole('link', { name: 'Pool API & model', exact: true }).first().click();
    await expect(page).toHaveURL('/admin/api-pool');
    const name = 'Server kiểm thử E2E ' + Date.now();
    await page.getByRole('button', { name: 'Thêm cấu hình API', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Mẫu nhà cung cấp').selectOption('ollama');
    await dialog.getByLabel('Tên cấu hình', { exact: true }).fill(name);
    await dialog.getByLabel('Base URL', { exact: true }).fill(baseUrl);
    await dialog.getByRole('button', { name: 'Lưu cấu hình', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const created = (await (await page.request.get('/api/v1/admin/api-pool')).json()).profiles.find(
      (p: any) => p.name === name,
    );
    expect(created).toBeTruthy();
    id = created.id;
    const card = page.locator('.pool-profile').filter({ hasText: name });
    await expect(card).toContainText('Chưa chọn model');
    await card.getByRole('button', { name: 'Tải model', exact: true }).click();
    await expect(card).toContainText('Đã nhận 1 model');
    await card.getByRole('button', { name: 'Sửa ' + name, exact: true }).click();
    await dialog.getByLabel('Model từ máy chủ', { exact: true }).selectOption('fixture-e2e-model');
    await dialog.getByRole('checkbox', { name: /Tôi đã kiểm tra giá/ }).uncheck();
    await page.screenshot({ path: 'reports/screenshots/api-pool-editor.png', fullPage: true });
    await dialog.getByRole('button', { name: 'Lưu cấu hình', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByLabel('Cấu hình cần thử', { exact: true }).selectOption(id);
    await expect(card).toContainText('Chưa xác nhận giá token');
    await expect(card).toContainText('Cần hoàn thiện cấu hình');
    await expect(page.getByRole('button', { name: 'Gửi thử API', exact: true })).toBeDisabled();
    expect(calls).toHaveLength(0);
    await page.getByRole('button', { name: 'Hoàn thiện cấu hình', exact: true }).click();
    await dialog.getByRole('checkbox', { name: /Tôi đã kiểm tra giá/ }).check();
    await dialog.getByRole('button', { name: 'Lưu cấu hình', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', { name: 'Gửi thử API', exact: true }).click();
    await expect(page.locator('.pool-test-result')).toContainText('Nhận được phản hồi từ API');
    await expect(page.locator('.pool-reply')).toContainText('PHẢN HỒI TỪ SERVER KIỂM THỬ');
    await expect(card).toContainText('Sẵn sàng phục vụ chat');
    await page.getByRole('switch', { name: 'Bật pool phục vụ chat' }).check();
    await page.getByLabel('Cách chọn API', { exact: true }).selectOption('manual');
    await page.getByLabel('Câu hỏi thông thường', { exact: true }).selectOption(id);
    await page.getByLabel('Câu hỏi tổng hợp', { exact: true }).selectOption(id);
    await page.getByRole('button', { name: 'Lưu lựa chọn cho chat', exact: true }).click();
    await expect(card).toContainText('Đang phục vụ chat');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: 'reports/screenshots/api-pool-desktop.png',
      fullPage: true,
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().right))
      .toBeLessThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: 'reports/screenshots/api-pool-mobile.png',
      fullPage: true,
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/');
    await page.getByRole('button', { name: /Hiểu rõ kết quả học tập/ }).click();
    await expect(page.locator('.message.assistant')).toContainText('PHẢN HỒI TỪ SERVER KIỂM THỬ');
    await expect(page.locator('.message-author')).toContainText(name);
    await expect(page.locator('.citation').first()).toHaveAttribute('href', /nau.edu.vn/);
    expect(calls.length).toBe(2);
    expect(calls.every((c) => c.model === 'fixture-e2e-model')).toBe(true);
    await page
      .getByRole('textbox', { name: 'Câu hỏi của bạn', exact: true })
      .fill('Nói ngắn hơn giúp mình');
    await page.getByRole('button', { name: 'Gửi câu hỏi', exact: true }).click();
    await expect(page.locator('.message.assistant')).toHaveCount(2);
    await expect(page.locator('.message.assistant').last()).toContainText(
      'PHẢN HỒI TỪ SERVER KIỂM THỬ',
    );
    expect(calls.length).toBe(3);
    const followUpPayload = JSON.parse(calls[2].messages[1].content);
    expect(
      followUpPayload.history.some(
        (m: any) => m.role === 'user' && m.content.includes('học phần cốt lõi'),
      ),
    ).toBe(true);

    const guest = await browser.newContext();
    try {
      const req = guest.request;
      for (const [method, url, data] of [
        ['get', '', undefined],
        ['post', '/profiles', {}],
        ['patch', '/profiles/' + id, {}],
        ['delete', '/profiles/' + id, {}],
        ['post', '/profiles/' + id + '/models', {}],
        ['post', '/profiles/' + id + '/test', { question: 'test' }],
        ['post', '/routing', {}],
      ] as const) {
        const r = await req.fetch('/api/v1/admin/api-pool' + url, { method, data });
        expect(r.status()).toBe(401);
      }
      expect(
        (
          await req.post('/api/v1/auth/login', {
            data: { username: 'sv007', password: 'NauDemo2026!' },
          })
        ).ok(),
      ).toBe(true);
      expect((await req.get('/api/v1/admin/api-pool')).status()).toBe(403);
      expect(
        (
          await req.post('/api/v1/admin/api-pool/profiles/' + id + '/test', {
            data: { question: 'test' },
          })
        ).status(),
      ).toBe(403);
    } finally {
      await guest.close();
    }
    expect(
      (await page.request.post('/api/v1/admin/api-pool/routing', { data: originalRouting })).ok(),
    ).toBe(true);
    await page.goto('/admin/api-pool');
    await page.getByRole('button', { name: 'Xóa ' + name, exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Xóa cấu hình', exact: true })
      .click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator('.pool-profile').filter({ hasText: name })).toHaveCount(0);
    id = '';
  } finally {
    try {
      if (originalRouting)
        expect
          .soft(
            (
              await page.request.post('/api/v1/admin/api-pool/routing', { data: originalRouting })
            ).ok(),
          )
          .toBe(true);
      if (id)
        expect
          .soft(
            (await page.request.delete('/api/v1/admin/api-pool/profiles/' + id, { data: {} })).ok(),
          )
          .toBe(true);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});
