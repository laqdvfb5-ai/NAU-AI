import { request } from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as cheerio from 'cheerio';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Queue, Worker } from 'bullmq';
import { normalize } from '@nau/domain';
import { Database } from './database.js';
import { env } from './config.js';
import type { KnowledgeSource } from './sources.js';
const run = promisify(execFile);
const allowedHosts = new Set([
  'nau.edu.vn',
  'www.nau.edu.vn',
  'naue.edu.vn',
  'www.naue.edu.vn',
  'eng.naue.edu.vn',
  'lms.naue.edu.vn',
  'thuvienso.naue.edu.vn',
  'xettuyen.nau.edu.vn',
  'sinhvien.nau.edu.vn',
]);
const blocked = new BlockList();
for (const [ip, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['192.0.0.0', 24],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(ip, prefix, 'ipv4');
export function validateSourceUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !allowedHosts.has(url.hostname)
  )
    throw new Error(
      'Chỉ chấp nhận HTTPS từ website trường và các tên miền dịch vụ chính thức đã kiểm tra.',
    );
  return url;
}
export function detectsPrivateData(text: string) {
  const n = normalize(text);
  return (
    /danh sach.{0,50}(diem|sinh vien)|bang diem|ma sinh vien|so can cuoc|so cmnd|ngay sinh|so dien thoai.{0,40}ho ten/.test(
      n,
    ) || /\b\d{12}\b/.test(n)
  );
}
export function extractOfficialHtml(html: string) {
  const $ = cheerio.load(html);
  // ASP.NET pages can wrap their entire public article in a server-side form.
  // Keep those wrappers, but discard controls and their submitted/default values.
  $('script,style,noscript,nav,footer,header,iframe,input,textarea,select,button,output').remove();
  for (const selector of ['main', 'article', 'body']) {
    const text = $(selector)
      .text()
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();
    if (text) return text;
  }
  return '';
}
export async function downloadOfficial(
  value: string,
  redirects = 0,
): Promise<{ buffer: Buffer; contentType: string; url: string }> {
  if (redirects > 4) throw new Error('Quá nhiều chuyển hướng.');
  const url = validateSourceUrl(value);
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (
    !addresses.length ||
    addresses.some((a) => isIP(a.address) !== 4 || blocked.check(a.address, 'ipv4'))
  )
    throw new Error('Nguồn trỏ đến địa chỉ mạng không được phép.');
  const result = await new Promise<{ buffer: Buffer; contentType: string; location?: string }>(
    (ok, reject) => {
      const req = request(
        url,
        {
          headers: {
            'User-Agent': 'NAU-AI-Knowledge/0.1 (public documents; manual review)',
            Accept: 'text/html,application/pdf',
          },
          lookup: (_host, options, cb) =>
            options.all ? cb(null, addresses) : cb(null, addresses[0].address, 4),
        },
        (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            ok({
              buffer: Buffer.alloc(0),
              contentType: '',
              location: new URL(res.headers.location, url).href,
            });
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`Nguồn trả HTTP ${res.statusCode}`));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (c) => {
            size += c.length;
            if (size > 15 * 1024 * 1024) req.destroy(new Error('Tài liệu vượt 15 MB.'));
            else chunks.push(c);
          });
          res.on('end', () =>
            ok({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || '' }),
          );
          res.on('error', reject);
        },
      );
      req.setTimeout(20000, () => req.destroy(new Error('Nguồn không phản hồi sau 20 giây.')));
      req.on('error', reject);
      req.end();
    },
  );
  return result.location
    ? downloadOfficial(result.location, redirects + 1)
    : { ...result, url: url.href };
}
async function extractPdf(buffer: Buffer) {
  const loading = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  const pdf = await loading.promise;
  try {
    if (pdf.numPages > 120) throw new Error('Tài liệu quá 120 trang; cần chia nhỏ.');
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const p = await pdf.getPage(n);
      const c = await p.getTextContent();
      pages.push(`[Trang PDF ${n}]\n` + c.items.map((i) => ('str' in i ? i.str : '')).join(' '));
    }
    if (
      pages
        .join('')
        .replace(/\[Trang PDF \d+\]/g, '')
        .trim().length >
      pdf.numPages * 35
    )
      return { text: pages.join('\n\n'), ocr: false };
  } finally {
    await loading.destroy();
  }
  const dir = await mkdtemp(join(tmpdir(), 'nau-ocr-'));
  try {
    const file = join(dir, 'document.pdf');
    await writeFile(file, buffer);
    await run('pdftoppm', ['-png', '-scale-to', '1600', file, join(dir, 'page')], {
      timeout: 180000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const files = (await readdir(dir))
      .filter((f) => /^page-\d+\.png$/.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const texts: string[] = [];
    for (const [i, f] of files.entries()) {
      const output = await run('tesseract', [join(dir, f), 'stdout', '-l', 'vie+eng'], {
        timeout: 45000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      });
      texts.push(`[Trang PDF ${i + 1} · OCR cần kiểm tra]\n${output.stdout}`);
    }
    if (!texts.join('').trim()) throw new Error('OCR không đọc được nội dung.');
    return { text: texts.join('\n\n'), ocr: true };
  } catch {
    throw new Error(
      'Tài liệu quét chưa đọc được. Cài poppler và tesseract (vie+eng) hoặc dùng worker Docker để OCR.',
    );
  } finally {
    if (
      resolve(dir).startsWith(resolve(tmpdir()) + '\\nau-ocr-') ||
      resolve(dir).startsWith(resolve(tmpdir()) + '/nau-ocr-')
    )
      await rm(dir, { recursive: true, force: true });
  }
}
export class IngestionService {
  private queue?: Queue;
  private worker?: Worker;
  private timer?: ReturnType<typeof setInterval>;
  private running = new Set<string>();
  constructor(
    private db: Database,
    private download: typeof downloadOfficial = downloadOfficial,
  ) {}
  async start() {
    if (env.redisUrl) {
      const u = new URL(env.redisUrl);
      const connection = {
        host: u.hostname,
        port: Number(u.port || 6379),
        password: u.password || undefined,
        username: u.username || undefined,
        tls: u.protocol === 'rediss:' ? {} : undefined,
      };
      this.queue = new Queue('nau-knowledge', { connection });
      this.worker = new Worker(
        'nau-knowledge',
        async (job) => (job.name === 'daily' ? this.refreshAll() : this.refresh(job.data.id)),
        { connection, concurrency: 2 },
      );
      await this.queue.upsertJobScheduler(
        'daily-refresh',
        { every: 24 * 3600000 },
        { name: 'daily', data: {}, opts: { removeOnComplete: 100, removeOnFail: 100 } },
      );
      this.worker.on('error', (e) => console.error('Worker error:', e.message));
    }
    this.timer = setInterval(() => {
      void this.db.cleanup();
      if (!this.queue) void this.refreshAll();
    }, 24 * 3600000);
    this.timer.unref();
    await this.db.cleanup();
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    await this.worker?.close();
    await this.queue?.close();
  }
  async enqueue(id: string) {
    if (this.queue) {
      const job = await this.queue.add(
        'refresh',
        { id },
        { removeOnComplete: 100, removeOnFail: 100 },
      );
      return { queued: true, jobId: job.id };
    }
    if (this.running.has(id)) return { queued: true };
    void this.refresh(id);
    return { queued: true, mode: 'local-worker' };
  }
  async discover(startUrl = 'https://nau.edu.vn/', limit = 40) {
    const file = await this.download(startUrl);
    if (!file.contentType.includes('html')) throw new Error('Chỉ khám phá liên kết từ trang HTML.');
    const $ = cheerio.load(file.buffer.toString('utf8'));
    const known = new Set(
      (await this.db.query<{ data: KnowledgeSource }>('SELECT data FROM sources')).map(
        (r) => r.data.url,
      ),
    );
    let added = 0,
      excluded = 0;
    const candidates = $('a[href]')
      .toArray()
      .map((el) => ({
        href: $(el).attr('href')!,
        title: $(el).text().trim().replace(/\s+/g, ' '),
      }));
    for (const candidate of candidates) {
      if (added >= limit) break;
      if (candidate.title.length < 5) continue;
      let url: URL;
      try {
        url = validateSourceUrl(new URL(candidate.href, file.url).href);
      } catch {
        continue;
      }
      url.hash = '';
      if (known.has(url.href) || /\.(jpg|png|gif|mp4|zip|rar|exe|js|css)$/i.test(url.pathname))
        continue;
      const privateListing = detectsPrivateData(candidate.title);
      if (privateListing) excluded++;
      await this.save({
        id: randomUUID(),
        title: candidate.title.slice(0, 200),
        url: url.href,
        version: 'Mới khám phá · chưa duyệt',
        updatedAt: new Date().toISOString().slice(0, 10),
        effectiveFrom: null,
        admissionAfter: null,
        kind: /\.pdf$/i.test(url.pathname) ? 'pdf' : 'html',
        topic: 'Chưa phân loại',
        status: privateListing ? 'excluded' : 'pending',
        reviewed: false,
        excerpt: '',
        error: privateListing ? 'Tiêu đề có dấu hiệu danh sách/hồ sơ sinh viên.' : undefined,
      });
      known.add(url.href);
      added++;
    }
    return {
      added,
      excluded,
      note: 'Nguồn mới chỉ được đăng ký chờ duyệt; tải và kiểm tra trước khi đưa vào tra cứu.',
    };
  }
  async refreshAll() {
    const rows = await this.db.query("SELECT id FROM sources WHERE data->>'status'<>'excluded'");
    for (const row of rows) await this.refresh(row.id);
  }
  async refresh(id: string) {
    if (this.running.has(id)) return;
    this.running.add(id);
    try {
      const [row] = await this.db.query<{ data: KnowledgeSource }>(
        'SELECT data FROM sources WHERE id=$1',
        [id],
      );
      if (!row) return;
      const source = row.data;
      try {
        const file = await this.download(source.url);
        const hash = createHash('sha256').update(file.buffer).digest('hex');
        source.lastCheckedAt = new Date().toISOString();
        const hasStoredText =
          source.pendingText === undefined
            ? source.reviewed && Boolean(source.excerpt.trim())
            : Boolean(source.pendingText.trim());
        if (source.contentHash === hash && hasStoredText) {
          source.error = undefined;
          await this.save(source);
          return;
        }
        const extracted =
          file.contentType.includes('pdf') || file.buffer.subarray(0, 4).toString() === '%PDF'
            ? await extractPdf(file.buffer)
            : (() => {
                if (!file.contentType.includes('html'))
                  throw new Error('Định dạng chưa hỗ trợ; cần HTML hoặc PDF.');
                return {
                  text: extractOfficialHtml(file.buffer.toString('utf8')),
                  ocr: false,
                };
              })();
        if (!extracted.text.trim())
          throw new Error('Không trích xuất được nội dung tài liệu; cần kiểm tra nguồn.');
        source.contentHash = hash;
        source.pendingText = extracted.text.slice(0, 350000);
        source.status = detectsPrivateData(extracted.text) ? 'excluded' : 'pending';
        source.error =
          source.status === 'excluded'
            ? 'Phát hiện dấu hiệu danh sách/điểm/hồ sơ cá nhân; loại khỏi hỏi đáp công khai.'
            : extracted.ocr
              ? 'Đã OCR; cần kiểm tra bản gốc trước khi duyệt.'
              : undefined;
        source.reviewed = false;
        // A changed source is removed from retrieval until the new version is reviewed.
        await this.db.query('DELETE FROM chunks WHERE source_id=$1', [id]);
        await this.save(source);
        await this.db.audit('worker', 'source_refreshed', { sourceId: id, status: source.status });
      } catch (e) {
        source.status = (e as Error).message.includes('OCR') ? 'unreadable' : 'error';
        source.error = (e as Error).message;
        source.lastCheckedAt = new Date().toISOString();
        await this.save(source);
      }
    } finally {
      this.running.delete(id);
    }
  }
  async save(source: KnowledgeSource) {
    await this.db.query(
      'INSERT INTO sources(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      [source.id, JSON.stringify(source)],
    );
  }
  async approve(
    id: string,
    excerpt: string,
    version: string,
    actor: string,
    page?: number,
    article?: string,
  ) {
    const [row] = await this.db.query<{ data: KnowledgeSource }>(
      'SELECT data FROM sources WHERE id=$1',
      [id],
    );
    if (!row) throw new Error('Nguồn không tồn tại.');
    if (detectsPrivateData(excerpt)) throw new Error('Nội dung có dấu hiệu dữ liệu cá nhân.');
    if (row.data.status === 'excluded')
      throw new Error('Nguồn bị loại cần kiểm tra và làm sạch bên ngoài kho công khai.');
    if (row.data.kind === 'pdf' && (!page || !article))
      throw new Error('Nguồn PDF cần trang và điều khoản/mục đã kiểm tra.');
    await this.db.query('INSERT INTO source_versions(id,source_id,data) VALUES($1,$2,$3)', [
      randomUUID(),
      id,
      JSON.stringify(row.data),
    ]);
    const source = {
      ...row.data,
      excerpt,
      version,
      page,
      article,
      reviewed: true,
      status: 'active' as const,
      updatedAt: new Date().toISOString().slice(0, 10),
      pendingText: undefined,
      error: undefined,
    };
    await this.save(source);
    await this.db.indexSource(id, excerpt, source);
    await this.db.audit(actor, 'source_approved', { sourceId: id, version });
    return source;
  }
}
