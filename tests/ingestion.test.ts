import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Database } from '../apps/api/src/database.js';
import {
  extractOfficialHtml,
  IngestionService,
  officialContentHash,
} from '../apps/api/src/ingestion.js';
import type { KnowledgeSource } from '../apps/api/src/sources.js';

const db = new Database({ memory: true });
before(async () => db.initialize());
after(async () => db.close());

const html = '<form runat="server"><main>Mẫu đơn đăng ký ký túc xá.</main></form>';
const htmlHash = officialContentHash(Buffer.from(html), 'text/html');

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

test('HTML fingerprint ignores ASP.NET form state, executable content and styling', () => {
  const page = (state: string) => `
    <html><head><title>Biểu mẫu NAU</title><style>.dynamic-${state} { color: green }</style></head>
    <body class="layout-${state}"><form runat="server" action="?state=${state}">
      <input type="hidden" name="__VIEWSTATE" value="${state}">
      <input type="hidden" name="__EVENTVALIDATION" value="${state}">
      <textarea>${state}</textarea><select><option>${state}</option></select>
      <script>const state = '${state}'</script><template>${state}</template>
      <span hidden data-state="${state}">${state}</span>
      <nav><a href="https://sinhvien.nau.edu.vn/">Cổng sinh viên</a></nav>
      <main style="color: ${state}">Mẫu đơn năm 2026, hạn 30/09/2026.</main>
    </form></body></html>`;
  const first = officialContentHash(Buffer.from(page('first')), 'text/html');
  const second = officialContentHash(Buffer.from(page('second')), 'text/html; charset=utf-8');
  assert.match(first, /^html-v1:[a-f0-9]{64}$/);
  assert.equal(first, second);
});

test('HTML fingerprint detects visible content, title and article or navigation link changes', () => {
  const original = `
    <html><head><title>Biểu mẫu năm 2026</title></head><body>
      <header><nav><a href="/portal" title="Cổng sinh viên">Sinh viên</a></nav></header>
      <main><p>Hạn 30/09/2026, lệ phí 100.000 đồng.</p><a href="/form-2026.docx">Tải mẫu</a></main>
    </body></html>`;
  const originalHash = officialContentHash(Buffer.from(original), 'text/html');
  for (const [before, after] of [
    ['30/09/2026', '01/10/2026'],
    ['100.000', '200.000'],
    ['Biểu mẫu năm 2026', 'Biểu mẫu năm 2027'],
    ['href="/form-2026.docx"', 'href="/form-2027.docx"'],
    ['href="/portal"', 'href="https://sinhvien.nau.edu.vn/"'],
    ['title="Cổng sinh viên"', 'title="Cổng tuyển sinh"'],
    ['>Sinh viên<', '>Tuyển sinh<'],
  ]) {
    assert.notEqual(
      officialContentHash(Buffer.from(original.replace(before, after)), 'text/html'),
      originalHash,
      `${before} -> ${after}`,
    );
  }
});

test('HTML fingerprint ignores only standalone view-counter spans, preserving numeric evidence', () => {
  const page = `
    <body><main>Biểu mẫu ký túc xá</main><aside>
      <span>1.848 lượt xem</span><span>1,277  người xem</span>
      <span>Hạn nộp: 30/09/2026</span><span>Lệ phí: 100.000 đồng</span>
      <span>100 lượt xem xét hồ sơ</span>
    </aside></body>`;
  const initialHash = officialContentHash(Buffer.from(page), 'text/html');
  const updatedCounters = page.replace('1.848', '1.851').replace('1,277', '1,280');
  assert.equal(officialContentHash(Buffer.from(updatedCounters), 'text/html'), initialHash);
  for (const [before, after] of [
    ['30/09/2026', '01/10/2026'],
    ['100.000 đồng', '200.000 đồng'],
    ['100 lượt xem xét hồ sơ', '200 lượt xem xét hồ sơ'],
  ])
    assert.notEqual(
      officialContentHash(Buffer.from(page.replace(before, after)), 'text/html'),
      initialHash,
    );
});

test('PDF fingerprints retain byte hashing, including PDFs identified by their magic bytes', () => {
  const pdf = Buffer.from('%PDF-1.7\nfixture-document-bytes');
  const expected = createHash('sha256').update(pdf).digest('hex');
  for (const contentType of ['application/pdf', 'application/octet-stream', 'text/html'])
    assert.equal(officialContentHash(pdf, contentType), expected);
  assert.notEqual(
    officialContentHash(Buffer.concat([pdf, Buffer.from('\n')]), 'application/pdf'),
    expected,
  );
});

test('legacy raw HTML hashes enter the existing review path before semantic hashing is trusted', async () => {
  const ingestion = service();
  const original = source('ingestion-legacy-raw-hash', {
    contentHash: createHash('sha256').update(html).digest('hex'),
    status: 'active',
    reviewed: true,
    excerpt: 'Trích đoạn đã duyệt.',
  });
  await ingestion.save(original);
  await ingestion.refresh(original.id);
  const saved = await readSource(original.id);
  assert.equal(saved.contentHash, htmlHash);
  assert.equal(saved.status, 'pending');
  assert.equal(saved.reviewed, false);
  assert.equal(saved.excerpt, original.excerpt);
  assert.equal(saved.pendingText, 'Mẫu đơn đăng ký ký túc xá.');
});

test('only ASP.NET state changes leave reviewed semantic snapshots and retrieval chunks active', async () => {
  const originalHtml = `<form><input name="__VIEWSTATE" value="before"><main>Đơn đăng ký ký túc xá.</main></form>`;
  const ingestion = service(originalHtml.replace('value="before"', 'value="after"'));
  const original = source('ingestion-state-only-change', {
    contentHash: officialContentHash(Buffer.from(originalHtml), 'text/html'),
    status: 'active',
    reviewed: true,
    excerpt: 'Đơn đăng ký ký túc xá.',
  });
  await ingestion.save(original);
  await db.indexSource(original.id, original.excerpt, original);
  await ingestion.refresh(original.id);
  const saved = await readSource(original.id);
  assert.equal(saved.contentHash, original.contentHash);
  assert.equal(saved.status, 'active');
  assert.equal(saved.reviewed, true);
  assert.equal(saved.pendingText, undefined);
  assert.ok((await db.query('SELECT id FROM chunks WHERE source_id=$1', [original.id])).length);
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
