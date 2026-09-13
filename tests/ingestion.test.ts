import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Database } from '../apps/api/src/database.js';
import { extractOfficialHtml, IngestionService } from '../apps/api/src/ingestion.js';
import type { KnowledgeSource } from '../apps/api/src/sources.js';

const db = new Database({ memory: true });
before(async () => db.initialize());
after(async () => db.close());

const html = '<form runat="server"><main>Mẫu đơn đăng ký ký túc xá.</main></form>';
const htmlHash = createHash('sha256').update(html).digest('hex');

function service(content = html) {
  return new IngestionService(db, async (url) => ({
    buffer: Buffer.from(content),
    contentType: 'text/html; charset=utf-8',
    url,
  }));
}

function source(id: string, changes: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    id,
    title: 'Biểu mẫu thử nghiệm',
    url: 'https://nau.edu.vn/test-fixture.aspx',
    kind: 'html',
    version: 'test',
    updatedAt: '2026-09-13',
    effectiveFrom: null,
    admissionAfter: null,
    topic: 'Ký túc xá',
    status: 'pending',
    reviewed: false,
    excerpt: '',
    ...changes,
  };
}

async function readSource(id: string) {
  const [row] = await db.query<{ data: KnowledgeSource }>('SELECT data FROM sources WHERE id=$1', [
    id,
  ]);
  assert.ok(row);
  return row.data;
}

test('HTML extraction keeps public content inside ASP.NET forms and excludes controls', () => {
  const text = extractOfficialHtml(`
    <html><head><style>private-style</style><script>private-script</script></head><body>
      <form id="form1" runat="server">
        <input type="hidden" name="__VIEWSTATE" value="private-viewstate">
        <header>Navigation heading</header><nav>Navigation links</nav>
        <main>
          <h1>Biểu mẫu học tập</h1>
          <p>Tải <a href="/forms/leave.docx">đơn xin nghỉ học tạm thời</a>.</p>
          <input type="password" value="private-password">
          <textarea>private-note</textarea>
          <select><option selected>private-selection</option></select>
          <button>private-button</button><output>private-output</output>
          <iframe>private-frame</iframe><noscript>private-noscript</noscript>
        </main>
        <footer>Footer links</footer>
      </form>
    </body></html>
  `);
  assert.match(text, /Biểu mẫu học tập/);
  assert.match(text, /Tải đơn xin nghỉ học tạm thời\./);
  assert.doesNotMatch(text, /private-|Navigation|Footer|__VIEWSTATE/);
});

test('HTML extraction prefers nonempty main, then article, then body', () => {
  assert.equal(
    extractOfficialHtml('<body>Outside<article>Article</article><main>Main</main></body>'),
    'Main',
  );
  assert.equal(
    extractOfficialHtml('<form><main> \n </main><article>Article</article>Outside</form>'),
    'Article',
  );
  assert.equal(
    extractOfficialHtml('<form><main> </main><article> </article><p>Body</p></form>'),
    'Body',
  );
});

test('HTML with only whitespace, navigation or form controls yields no extracted content', () => {
  for (const fixture of [
    '',
    '<form><main> \n\t </main></form>',
    '<form><input value="hidden"><textarea>private</textarea><nav>Menu</nav></form>',
  ])
    assert.equal(extractOfficialHtml(fixture), '');
});

test('changed HTML inside a server form is staged for review and removes stale chunks', async () => {
  const ingestion = service();
  const original = source('ingestion-changed', {
    status: 'active',
    reviewed: true,
    excerpt: 'Bản đã kiểm tra trước đây.',
    contentHash: 'previous-hash',
  });
  await ingestion.save(original);
  await db.indexSource(original.id, original.excerpt, original);
  assert.ok((await db.query('SELECT id FROM chunks WHERE source_id=$1', [original.id])).length);

  await ingestion.refresh(original.id);
  const saved = await readSource(original.id);
  assert.equal(saved.status, 'pending');
  assert.equal(saved.reviewed, false);
  assert.equal(saved.contentHash, htmlHash);
  assert.equal(saved.pendingText, 'Mẫu đơn đăng ký ký túc xá.');
  assert.equal(saved.excerpt, original.excerpt);
  assert.equal(
    (await db.query('SELECT id FROM chunks WHERE source_id=$1', [original.id])).length,
    0,
  );
});

test('empty extraction records an error without replacing an existing snapshot or hash', async () => {
  const ingestion = service('<form><input value="private"><main> </main></form>');
  const original = source('ingestion-empty', {
    contentHash: 'previous-valid-hash',
    pendingText: 'Nội dung đang chờ kiểm tra.',
    excerpt: 'Trích đoạn đã duyệt.',
  });
  await ingestion.save(original);

  await ingestion.refresh(original.id);
  const saved = await readSource(original.id);
  assert.equal(saved.status, 'error');
  assert.match(saved.error || '', /Không trích xuất được nội dung/);
  assert.equal(saved.contentHash, original.contentHash);
  assert.equal(saved.pendingText, original.pendingText);
  assert.equal(saved.excerpt, original.excerpt);
  assert.ok(saved.lastCheckedAt);
});

test('legacy empty snapshots are retried even when the downloaded hash has not changed', async () => {
  const ingestion = service();
  for (const [suffix, pendingText] of [
    ['empty', ''],
    ['whitespace', ' \n '],
  ]) {
    const original = source(`ingestion-legacy-${suffix}`, { contentHash: htmlHash, pendingText });
    await ingestion.save(original);

    await ingestion.refresh(original.id);
    const saved = await readSource(original.id);
    assert.equal(saved.contentHash, htmlHash);
    assert.equal(saved.pendingText, 'Mẫu đơn đăng ký ký túc xá.');
    assert.equal(saved.status, 'pending');
    assert.equal(saved.reviewed, false);
  }
});

test('unchanged valid pending snapshots keep their review state and extracted text', async () => {
  const ingestion = service();
  const original = source('ingestion-unchanged-pending', {
    contentHash: htmlHash,
    pendingText: 'Nội dung đã trích xuất đang chờ kiểm tra.',
  });
  await ingestion.save(original);

  await ingestion.refresh(original.id);
  const saved = await readSource(original.id);
  assert.equal(saved.pendingText, original.pendingText);
  assert.equal(saved.status, 'pending');
  assert.equal(saved.reviewed, false);
});

test('unchanged reviewed sources with no pending snapshot remain active', async () => {
  const ingestion = service();
  const original = source('ingestion-unchanged-active', {
    contentHash: htmlHash,
    excerpt: 'Trích đoạn được kiểm tra thủ công.',
    status: 'active',
    reviewed: true,
  });
  await ingestion.save(original);

  await ingestion.refresh(original.id);
  const saved = await readSource(original.id);
  assert.equal(saved.excerpt, original.excerpt);
  assert.equal(saved.pendingText, undefined);
  assert.equal(saved.status, 'active');
  assert.equal(saved.reviewed, true);
});
