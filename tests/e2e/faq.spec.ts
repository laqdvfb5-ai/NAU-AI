import { test, expect } from '@playwright/test';

test('FAQ supports unaccented search and opens a draft without sending a model request', async ({
  page,
}) => {
  let chats = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/chat') chats++;
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/faq');
  await expect(page.getByRole('heading', { name: 'Bạn đang băn khoăn điều gì?' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('60 câu hỏi gợi ý');
  await page.getByRole('textbox', { name: 'Tìm câu hỏi thường gặp' }).fill('bao luu');
  const question = 'Em muốn bảo lưu hoặc quay lại học sau bảo lưu thì cần thủ tục gì?';
  await page.getByRole('link', { name: question, exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Câu hỏi của bạn', exact: true })).toHaveValue(
    question,
  );
  await expect(page.getByRole('button', { name: 'Gửi câu hỏi', exact: true })).toBeEnabled();
  expect(chats).toBe(0);
  await expect(page.locator('.message')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('FAQ category filtering works on mobile and unknown FAQ ids cannot prefill text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/faq');
  await page.getByRole('button', { name: 'Chỗ ở & đời sống trong trường', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('5 câu hỏi gợi ý');
  await expect(
    page.getByRole('heading', { name: 'Chỗ ở & đời sống trong trường', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.goto('/?faq=unknown-catalog-id');
  await expect(page.getByRole('textbox', { name: 'Câu hỏi của bạn', exact: true })).toHaveValue('');
});
