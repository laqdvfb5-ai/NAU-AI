import { test, expect, MODEL_REPLY, chatEvents } from './helpers/model-fixture';

const VALID_IDENTITY_REPLY =
  'Mình là NAU AI, trợ lý AI của Trường Đại học Nghệ An. Mình được nghiên cứu và phát triển bởi hai đại thi hào K12A3 Lê Anh Quốc và Nguyễn Văn Thương.';
const VALID_IDENTITY_REPLY_ALTERNATE =
  'NAU AI đây! Hai đại thi hào K12A3 Lê Anh Quốc và Nguyễn Văn Thương đã nghiên cứu và phát triển mình thành trợ lý AI của Trường Đại học Nghệ An.';

test('reported model question receives the shared NAU identity prompt and exact model reply', async ({
  page,
  model,
}) => {
  const question = 'mayf là models gif';
  model.respondNext({ text: VALID_IDENTITY_REPLY });
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Câu hỏi của bạn', exact: true }).fill(question);
  await page.getByRole('button', { name: 'Gửi câu hỏi', exact: true }).click();
  await expect(page.locator('.message.assistant .message-text')).toHaveText(VALID_IDENTITY_REPLY);
  await expect(page.locator('.message.assistant .citation')).toHaveCount(0);
  expect(model.calls).toHaveLength(1);
  expect(model.calls[0].payload.question).toBe(question);
  const evidence = JSON.parse(model.calls[0].payload.evidence);
  expect(evidence.kind).toBe('conversation');
  expect(evidence.facts.intent).toBe('identity');
  const systemMessages = model.calls[0].messages.filter((message) => message.role === 'system');
  expect(systemMessages).toHaveLength(1);
  for (const marker of [
    'NAU AI',
    'Trường Đại học Nghệ An',
    'K12A3',
    'Lê Anh Quốc',
    'Nguyễn Văn Thương',
  ])
    expect(systemMessages[0].content).toContain(marker);
});

test('an upstream vendor-only identity is blocked before display', async ({ page, model }) => {
  model.respondNext({ text: 'GPT 5.5, OpenAI.' });
  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'Câu hỏi của bạn', exact: true })
    .fill('mayf là models gif');
  await page.getByRole('button', { name: 'Gửi câu hỏi', exact: true }).click();
  await expect(page.locator('.chat-page').getByRole('alert')).toContainText(
    'Model AI chưa giữ đúng danh tính NAU AI',
  );
  await expect(page.locator('.message.assistant')).toHaveCount(0);
  await expect(page.locator('.stream-preview')).toHaveCount(0);
  expect(model.calls).toHaveLength(1);
});

test('every original conversation turn calls the model without unrelated sources', async ({
  page,
  model,
}) => {
  await page.goto('/');
  const questions = [
    'bạn là ai ?',
    'hello nau ai',
    'ok mc mc mck hyperpopstar',
    'xin chào bạn la ai',
  ];
  for (let i = 0; i < questions.length; i++) {
    const identityReply =
      i === 0 ? VALID_IDENTITY_REPLY : i === 3 ? VALID_IDENTITY_REPLY_ALTERNATE : undefined;
    if (identityReply) model.respondNext({ text: identityReply });
    await page.getByRole('textbox', { name: 'Câu hỏi của bạn', exact: true }).fill(questions[i]);
    await page.getByRole('button', { name: 'Gửi câu hỏi', exact: true }).click();
    await expect(page.locator('.message.assistant')).toHaveCount(i + 1);
    await expect(page.locator('.message.assistant').last()).toContainText(
      identityReply || MODEL_REPLY,
    );
    await expect(page.locator('.message.assistant').last().locator('.citation')).toHaveCount(0);
    expect(model.calls.length).toBe(i + 1);
    expect(model.calls[i].payload.question).toBe(questions[i]);
    expect(JSON.parse(model.calls[i].payload.evidence).kind).toBe('conversation');
  }
});

test('model handles private, insufficient, hypothetical, denied and guest chat with real workflow stages', async ({
  page,
  model,
}) => {
  for (const [username, question, kind, stages] of [
    [null, 'hello', 'conversation', ['reasoning', 'generating']],
    [null, 'Điểm của tôi', 'login_required', ['reasoning', 'generating']],
    [null, 'Quy chế điểm PI', 'public', ['reasoning', 'searching', 'generating', 'validating']],
    ['sv031', 'Điểm của tôi', 'personal', ['reasoning', 'checking', 'generating', 'validating']],
    [
      'sv007',
      'Nếu chưa có điểm PI thì sao?',
      'hypothetical',
      ['reasoning', 'generating', 'validating'],
    ],
    ['sv007', 'Điểm của MOCK00019', 'access_denied', ['reasoning', 'generating']],
  ] as const) {
    if (username)
      expect(
        (
          await page.request.post('/api/v1/auth/login', {
            data: { username, password: 'NauDemo2026!' },
          })
        ).ok(),
      ).toBe(true);
    const count = model.calls.length;
    const response = await page.request.post('/api/v1/chat', { data: { message: question } });
    const events = chatEvents(await response.text());
    const answer = events.find((e) => e.event === 'answer')?.data;
    expect(answer?.text).toBe(MODEL_REPLY);
    expect(answer?.mode).toBe('pool');
    expect(model.calls.length).toBe(count + 1);
    expect(JSON.parse(model.calls.at(-1)!.payload.evidence).kind).toBe(kind);
    expect(events.filter((e) => e.event === 'status').map((e) => e.data.stage)).toEqual(stages);
    if (username === 'sv031') expect(answer.evaluations[0].status).toBe('insufficient');
    if (kind === 'access_denied') expect(answer.evaluations).toEqual([]);
  }
});

test('progress during generation and model failure retry without a canned answer', async ({
  page,
  model,
}) => {
  await page.goto('/');
  model.respondNext({ firstTokenDelayMs: 1000, finishDelayMs: 1000 });
  await page.getByRole('textbox', { name: 'Câu hỏi của bạn', exact: true }).fill('hello nau ai');
  await page.getByRole('button', { name: 'Gửi câu hỏi', exact: true }).click();
  const progress = page.getByTestId('chat-progress');
  await expect(progress.locator('[data-stage="generating"]')).toHaveAttribute(
    'data-state',
    'active',
  );
  await expect(progress).toContainText('Making answer');
  await expect(progress.locator('[data-stage="searching"]')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Model AI');
  await page.screenshot({
    path: 'reports/screenshots/model-progress.png',
    fullPage: true,
    animations: 'disabled',
  });
  await expect(page.locator('.stream-preview')).toBeVisible();
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  await expect(progress).toHaveCount(0);
  model.respondNext({ errorStatus: 500 });
  await page.getByRole('textbox', { name: 'Câu hỏi của bạn', exact: true }).fill('Cảm ơn bạn');
  await page.getByRole('button', { name: 'Gửi câu hỏi', exact: true }).click();
  await expect(page.locator('.chat-page').getByRole('alert')).toContainText(
    'Máy chủ API đang báo lỗi. Có thể thử lại sau.',
  );
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  await expect(page.locator('.stream-preview')).toHaveCount(0);
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(2);
  await expect(page.locator('.message.user')).toHaveCount(2);
  expect(model.calls).toHaveLength(3);
});

test('stopping and starting a new conversation discards late model output', async ({
  page,
  model,
}) => {
  await page.goto('/embed');
  await page.setViewportSize({ width: 390, height: 844 });
  model.respondNext({
    text: 'LATE STREAM MUST NOT APPEAR',
    firstTokenDelayMs: 1000,
    finishDelayMs: 1000,
  });
  await page.getByRole('textbox', { name: 'Câu hỏi của bạn', exact: true }).fill('hello');
  await page.getByRole('button', { name: 'Gửi câu hỏi', exact: true }).click();
  await expect(
    page.getByTestId('chat-progress').locator('[data-stage="generating"]'),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Dừng trả lời', exact: true }).click();
  await expect(page.locator('.chat-page').getByRole('alert')).toContainText('Đã dừng');
  await expect(page.getByTestId('chat-progress')).toHaveCount(0);
  await expect(page.locator('.message.assistant')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cuộc trò chuyện mới', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Câu hỏi của bạn', exact: true }).fill('Chào bạn');
  await page.getByRole('button', { name: 'Gửi câu hỏi', exact: true }).click();
  await expect(page.locator('.message.assistant')).toContainText(MODEL_REPLY);
  await page.waitForTimeout(2200);
  await expect(page.locator('.message.assistant')).toHaveCount(1);
  await expect(page.locator('.conversation')).not.toContainText('LATE STREAM');
});
