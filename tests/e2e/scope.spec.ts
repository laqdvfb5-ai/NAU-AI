import { test, expect } from './helpers/model-fixture';

test('software requests and continuations stay model-generated redirects, with invalid HTML buffered and rejected', async ({
  page,
  model,
}) => {
  await page.goto('/');
  const questionInput = page.getByRole('textbox', { name: 'Câu hỏi của bạn', exact: true });
  const send = async (question: string) => {
    await questionInput.fill(question);
    await page.getByRole('button', { name: 'Gửi câu hỏi', exact: true }).click();
  };
  const redirects = [
    'MODEL SCOPE REPLY 1: Mình hỗ trợ tư vấn sinh viên NAU. Bạn cần hỏi về ngành học hay học vụ?',
    'MODEL SCOPE REPLY 2: Mình không tiếp tục viết website bán hàng. Mình có thể giúp bạn tìm thông tin tuyển sinh NAU.',
  ];
  for (const [index, question] of ['viet code html web ban hang co ban', 'tiếp tục'].entries()) {
    model.respondNext({ text: redirects[index] });
    await send(question);
    await expect(page.locator('.message.assistant')).toHaveCount(index + 1);
    const assistant = page.locator('.message.assistant').last();
    await expect(assistant.locator('.message-text')).toHaveText(redirects[index]);
    await expect(assistant.locator('.citation, .evaluation')).toHaveCount(0);
    expect(model.calls).toHaveLength(index + 1);
    expect(model.calls[index].payload.question).toBe(question);
    expect(JSON.parse(model.calls[index].payload.evidence).kind).toBe('out_of_scope');
  }

  const conversationsResponse = await page.request.get('/api/v1/conversations');
  expect(conversationsResponse.ok()).toBe(true);
  const conversations = await conversationsResponse.json();
  expect(conversations).toHaveLength(1);
  const conversationId = conversations[0].id;
  const readHistory = async () => {
    const response = await page.request.get('/api/v1/conversations/' + conversationId);
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const beforeFailure = await readHistory();
  expect(beforeFailure).toHaveLength(4);
  for (const answer of beforeFailure.filter(
    (message: { role: string }) => message.role === 'assistant',
  )) {
    expect(answer.mode).toBe('pool');
    expect(answer.model).toBe('fixture-model-only');
    expect(answer.scope).toBe('out_of_scope');
    expect(answer.citations).toEqual([]);
    expect(answer.evaluations).toEqual([]);
  }

  // Record every preview inserted while the upstream sends two delayed HTML chunks.
  // Checking only the final DOM would miss a draft that flashed before rejection.
  await page.evaluate(() => {
    const state = window as typeof window & {
      scopePreviews: string[];
      scopeObserver: MutationObserver;
    };
    state.scopePreviews = [];
    state.scopeObserver = new MutationObserver(() => {
      for (const preview of document.querySelectorAll('.stream-preview'))
        state.scopePreviews.push(preview.textContent || '');
    });
    state.scopeObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  model.respondNext({
    text: '<!DOCTYPE html><html><body>UNRELATED_HTML_DRAFT_MUST_NOT_APPEAR</body></html>',
    firstTokenDelayMs: 250,
    finishDelayMs: 1500,
  });
  await send('Thêm CSS cho website đó');
  await expect(
    page.getByTestId('chat-progress').locator('[data-stage="generating"]'),
  ).toBeVisible();
  await expect(page.locator('.chat-page').getByRole('alert')).toContainText(
    'Model AI đã tạo nội dung ngoài phạm vi tư vấn',
  );
  expect(model.calls).toHaveLength(3);
  expect(JSON.parse(model.calls[2].payload.evidence).kind).toBe('out_of_scope');
  await expect(page.locator('.message.assistant')).toHaveCount(2);
  await expect(page.locator('.stream-preview')).toHaveCount(0);
  await expect(page.locator('.conversation')).not.toContainText(
    'UNRELATED_HTML_DRAFT_MUST_NOT_APPEAR',
  );
  const previews = await page.evaluate(() => {
    const state = window as typeof window & {
      scopePreviews: string[];
      scopeObserver: MutationObserver;
    };
    state.scopeObserver.disconnect();
    return state.scopePreviews;
  });
  expect(previews).toEqual([]);
  expect(await readHistory()).toEqual(beforeFailure);

  const schoolReply =
    'MODEL SCHOOL REPLY: Mình có thể giúp bạn tra thông tin học phí trong nguồn của trường.';
  model.respondNext({ text: schoolReply });
  await send('Còn học phí NAU?');
  await expect(page.locator('.message.assistant')).toHaveCount(3);
  await expect(page.locator('.message.assistant').last().locator('.message-text')).toHaveText(
    schoolReply,
  );
  await expect(page.locator('.message.assistant').last().locator('.citation')).not.toHaveCount(0);
  expect(model.calls).toHaveLength(4);
  expect(JSON.parse(model.calls[3].payload.evidence).kind).toBe('public');
  const finalHistory = await readHistory();
  expect(finalHistory).toHaveLength(6);
  expect(finalHistory.at(-1).text).toBe(schoolReply);
  expect(JSON.stringify(finalHistory)).not.toContain('UNRELATED_HTML_DRAFT_MUST_NOT_APPEAR');
});
