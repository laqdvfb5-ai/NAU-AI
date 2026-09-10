'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  Users,
  MessageSquare,
  Wallet,
  BookOpen,
  RefreshCw,
  Plus,
  ArrowUpRight,
  X,
  Activity,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import type { RulePack, ActionDefinition } from '@nau/domain';
import { Shell } from '../../components/shell';
import { useApp } from '../../components/app-provider';
import { api, post, date } from '../../lib/api';
type Source = {
  id: string;
  title: string;
  url: string;
  version: string;
  updatedAt: string;
  status: string;
  topic: string;
  excerpt: string;
  pendingText?: string;
  error?: string;
  page?: number;
  article?: string;
  kind: string;
};
export default function Admin() {
  const { identity, loading } = useApp();
  const [stats, setStats] = useState<any>(),
    [sources, setSources] = useState<Source[]>([]),
    [rules, setRules] = useState<RulePack[]>([]),
    [actions, setActions] = useState<ActionDefinition[]>([]),
    [audit, setAudit] = useState<any[]>([]),
    [tab, setTab] = useState('sources'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<Source | null>(null),
    [add, setAdd] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [form, setForm] = useState({
      title: '',
      url: '',
      topic: '',
      kind: 'html',
      effectiveFrom: '',
      admissionAfter: '',
    }),
    [review, setReview] = useState({ excerpt: '', version: '', article: '', page: '1' }),
    [ruleNote, setRuleNote] = useState('');
  async function refresh() {
    try {
      const [a, b, c, d, e] = await Promise.all([
        api('/admin/stats'),
        api('/admin/sources'),
        api('/admin/rules'),
        api('/actions'),
        api('/admin/audit'),
      ]);
      setStats(a);
      setSources(b);
      setRules(c);
      setActions(d);
      setAudit(e);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (identity?.role === 'admin') void refresh();
  }, [identity]);
  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
      setNotice(message);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!loading && identity?.role !== 'admin')
    return (
      <Shell title="Quản trị">
        <div className="empty-state">
          <ShieldCheck size={36} />
          <h2>Khu vực quản trị</h2>
          <p>Chức năng này chỉ dành cho tài khoản quản trị viên.</p>
          <Link className="button primary" href="/login">
            Đăng nhập
          </Link>
        </div>
      </Shell>
    );
  return (
    <Shell title="Tổng quan vận hành" eyebrow="QUẢN TRỊ NAU AI">
      <div className="page-content">
        <div className="page-intro">
          <div>
            <span className="section-kicker">CHẤT LƯỢNG BẮT ĐẦU TỪ CĂN CỨ</span>
            <h2>
              Một trợ lý đáng tin cậy<span className="heading-dot">.</span>
            </h2>
            <p>Theo dõi dữ liệu, nguồn kiến thức và chi phí thực tế.</p>
          </div>
          <div className="button-group">
            <Link href="/admin/api-pool" className="button primary compact">
              Pool API & model <ArrowUpRight size={15} />
            </Link>
            <button
              className="button secondary compact"
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw size={15} />
              Làm mới
            </button>
          </div>
        </div>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="alert success" role="status">
            <CheckCircle2 size={17} />
            {notice}
          </div>
        )}
        {stats ? (
          <>
            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-label">
                  <Users size={18} /> Hồ sơ thử nghiệm
                </span>
                <strong>{stats.students}</strong>
                <p>Dữ liệu giả được sinh tái lập</p>
              </div>
              <div className="stat-card">
                <span className="stat-label">
                  <MessageSquare size={18} /> Hội thoại lưu trữ
                </span>
                <strong>{stats.conversations}</strong>
                <p>Thời gian lưu {stats.retentionDays} ngày</p>
              </div>
              <div className="stat-card">
                <span className="stat-label">
                  <BookOpen size={18} /> Nguồn đã duyệt
                </span>
                <strong>
                  {stats.sources.active}
                  <small>/ {stats.sources.total}</small>
                </strong>
                <p>
                  {stats.sources.pending} chờ duyệt · {stats.sources.errors} lỗi đọc
                </p>
              </div>
              <div className="stat-card">
                <span className="stat-label">
                  <Wallet size={18} /> Chi phí model tháng này
                </span>
                <strong>${Number(stats.usage.cost_usd).toFixed(4)}</strong>
                <p>
                  Ngân sách ${stats.budgetUsd} · Dự phòng $
                  {Number(stats.usage.reserved_usd).toFixed(4)}
                </p>
                <div className="progress-track">
                  <span
                    style={{
                      width:
                        Math.min(
                          100,
                          (100 * Number(stats.usage.cost_usd)) / Math.max(1, stats.budgetUsd),
                        ) + '%',
                    }}
                  />
                </div>
              </div>
            </div>
            {stats.budgetWarning && (
              <div className="alert error">
                Chi phí và khoản dự phòng đã đạt 80% ngân sách tháng.
              </div>
            )}
            <div className="admin-system-line">
              <span>
                <span className="live-dot" />
                Hệ thống đang hoạt động
              </span>
              <span>
                Mô hình: <b>{stats.provider}</b>
              </span>
              <span>
                Embedding: <b>{stats.embedding}</b>
              </span>
              <span>
                {Number(stats.feedback.positive)}/{Number(stats.feedback.total)} đánh giá hữu ích
              </span>
            </div>
          </>
        ) : (
          <div className="loading-state">Đang tải thống kê…</div>
        )}
        <div className="tabs" role="tablist" aria-label="Quản trị">
          {[
            { id: 'sources', label: 'Nguồn kiến thức' },
            { id: 'rules', label: 'Quy chế & tác vụ' },
            { id: 'quality', label: 'Chất lượng & nhật ký' },
            { id: 'embed', label: 'Nhúng website' },
          ].map((t) => (
            <button
              role="tab"
              aria-selected={tab === t.id}
              key={t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'sources' && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h3>Quản lý nguồn công khai</h3>
                <p>Kiểm tra thay đổi hằng ngày; bản mới cần được duyệt lại.</p>
              </div>
              <div className="button-group">
                <button
                  className="button secondary compact"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = await post('/admin/discover', {
                        url: 'https://nau.edu.vn/',
                        limit: 40,
                      });
                      setNotice(
                        `Đã khám phá ${r.added} liên kết; ${r.excluded} mục có dấu hiệu hồ sơ cá nhân bị loại.`,
                      );
                    }, 'Đã khám phá liên kết từ website trường. Nguồn mới cần tải và duyệt.')
                  }
                >
                  Khám phá liên kết
                </button>
                <button
                  className="button secondary compact"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => post('/admin/reindex'),
                      'Đã tạo lại embedding cho các nguồn đã duyệt.',
                    )
                  }
                >
                  <RefreshCw size={14} />
                  Tạo lại chỉ mục
                </button>
                <button className="button primary compact" onClick={() => setAdd(true)}>
                  <Plus size={16} />
                  Thêm nguồn
                </button>
              </div>
            </div>
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Tài liệu / chủ đề</th>
                    <th>Trạng thái</th>
                    <th>Cập nhật</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <b>{s.title}</b>
                        <small>{s.topic}</small>
                        {s.error && <p className="form-error">{s.error}</p>}
                      </td>
                      <td>
                        <span
                          className={
                            'status-pill ' +
                            (s.status === 'active'
                              ? 'passed'
                              : s.status === 'pending'
                                ? 'insufficient'
                                : 'failed')
                          }
                        >
                          {
                            (
                              {
                                active: 'Đang dùng',
                                pending: 'Chờ duyệt',
                                error: 'Nguồn lỗi',
                                unreadable: 'Cần OCR',
                                excluded: 'Đã loại',
                              } as Record<string, string>
                            )[s.status]
                          }
                        </span>
                      </td>
                      <td>{date(s.updatedAt)}</td>
                      <td>
                        <div className="table-actions">
                          <button
                            className="icon-button"
                            aria-label={'Kiểm tra cập nhật ' + s.title}
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () => post('/admin/sources/' + s.id + '/refresh'),
                                'Đã đưa nguồn vào hàng đợi. Làm mới để xem kết quả.',
                              )
                            }
                          >
                            <RefreshCw size={16} />
                          </button>
                          <button
                            className="text-button"
                            onClick={() => {
                              setEdit(s);
                              setReview({
                                excerpt: s.excerpt,
                                version: s.version,
                                article: s.article || '',
                                page: String(s.page || 1),
                              });
                              setConfirmed(false);
                            }}
                          >
                            Duyệt
                          </button>
                          <a
                            className="icon-button"
                            aria-label={'Mở nguồn ' + s.title}
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ArrowUpRight size={16} />
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {tab === 'rules' && (
          <div className="schedule-layout">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h3>Quy chế áp dụng</h3>
                  <p>Quy tắc tính điểm được quản lý bằng mã có kiểm thử.</p>
                </div>
              </div>
              <div className="panel-padding">
                {rules.map((r) => (
                  <div className="rule-card" key={r.id}>
                    <span
                      className={
                        'status-pill ' + (r.institutionApproved ? 'passed' : 'insufficient')
                      }
                    >
                      {r.institutionApproved ? 'Đã xác nhận tại đơn vị' : 'Chờ nhà trường xác nhận'}
                    </span>
                    <h3>{r.title}</h3>
                    <p>Tuyển sinh sau {date(r.admissionAfter)} · Đại học chính quy</p>
                    <p className="microcopy">
                      Bản gốc đã được đối chiếu khi xây dựng. Đề cương và dữ liệu giả không phải dữ
                      liệu nghiệp vụ đã xác nhận.
                    </p>
                    <a
                      href={r.citation.url + '#page=11'}
                      target="_blank"
                      rel="noreferrer"
                      className="ask-link"
                    >
                      Mở quy chế gốc <ArrowUpRight size={14} />
                    </a>
                    <label htmlFor={'rule-note-' + r.id}>
                      Biên bản/ghi chú đối soát (tối thiểu 20 ký tự)
                    </label>
                    <textarea
                      id={'rule-note-' + r.id}
                      rows={3}
                      value={ruleNote}
                      onChange={(e) => setRuleNote(e.target.value)}
                    />
                    <button
                      className="button secondary full"
                      disabled={busy || ruleNote.trim().length < 20}
                      onClick={() =>
                        void run(
                          () =>
                            api('/admin/rules/' + r.id, {
                              method: 'PATCH',
                              body: JSON.stringify({
                                institutionApproved: !r.institutionApproved,
                                reviewNote: ruleNote,
                              }),
                            }),
                          'Đã lưu trạng thái xác nhận và nhật ký đối soát.',
                        )
                      }
                    >
                      {r.institutionApproved
                        ? 'Thu hồi xác nhận'
                        : 'Ghi nhận đã được nhà trường xác nhận'}
                    </button>
                  </div>
                ))}
              </div>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h3>Khả năng thực hiện tác vụ</h3>
                  <p>Mặc định tắt trong phiên bản đầu.</p>
                </div>
              </div>
              <div className="panel-padding">
                <div className="alert">
                  <AlertCircle size={20} />
                  <span>
                    Bật cờ không tạo ra kết nối xử lý. Mọi tác vụ dưới đây vẫn chưa thể thực thi.
                  </span>
                </div>
                {actions.map((a) => (
                  <div className="action-setting" key={a.id}>
                    <div>
                      <b>{a.name}</b>
                      <small>{a.handlerAvailable ? 'Có bộ xử lý' : 'Chưa có bộ xử lý'}</small>
                    </div>
                    <button
                      className={'switch ' + (a.enabled ? 'on' : '')}
                      role="switch"
                      aria-checked={a.enabled}
                      aria-label={'Bật cờ ' + a.name}
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            api('/admin/actions/' + a.id, {
                              method: 'PATCH',
                              body: JSON.stringify({ enabled: !a.enabled }),
                            }),
                          'Đã đổi cờ tác vụ. Khả năng thực thi vẫn phụ thuộc kết nối xử lý.',
                        )
                      }
                    >
                      <span />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
        {tab === 'quality' && (
          <div className="schedule-layout">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h3>Đánh giá chất lượng</h3>
                  <p>Kết quả kiểm thử được tạo trong thư mục reports.</p>
                </div>
                <Activity size={21} />
              </div>
              <div className="panel-padding">
                <div className="alert">
                  Chưa có báo cáo đánh giá mô hình AI trực tiếp trong giao diện. Không coi kiểm thử
                  dữ liệu giả là chứng nhận chất lượng trả lời trên dữ liệu thật.
                </div>
                <dl className="quality-list">
                  <div>
                    <dt>Bộ câu hỏi tiếng Việt</dt>
                    <dd>200 tình huống mẫu</dd>
                  </div>
                  <div>
                    <dt>Mục tiêu nghiệp vụ & phân quyền</dt>
                    <dd>100% ca xác định</dd>
                  </div>
                  <div>
                    <dt>Mục tiêu hỏi đáp có căn cứ</dt>
                    <dd>≥ 95% sau rà soát</dd>
                  </div>
                  <div>
                    <dt>Mục tiêu tải pilot</dt>
                    <dd>p95 &lt; 30 giây · lỗi &lt; 1%</dd>
                  </div>
                </dl>
                <p className="microcopy">
                  Chạy npm run evaluate và npm run load để ghi báo cáo đo thực tế. Cần người phụ
                  trách duyệt đáp án và đánh giá lại khi thay model hoặc quy chế.
                </p>
              </div>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h3>Nhật ký truy cập & thay đổi</h3>
                  <p>Không ghi nội dung hồ sơ vào nhật ký vận hành.</p>
                </div>
              </div>
              <div className="audit-list">
                {audit.slice(0, 30).map((a, i) => (
                  <div className="audit-item" key={i}>
                    <span className="live-dot" />
                    <div>
                      <b>{a.event}</b>
                      <small>
                        {a.actor} · {new Date(a.created_at).toLocaleString('vi-VN')}
                      </small>
                    </div>
                  </div>
                ))}
                {!audit.length && <p className="microcopy">Chưa có sự kiện.</p>}
              </div>
            </section>
          </div>
        )}
        {tab === 'embed' && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h3>Mang NAU AI đến website của trường</h3>
                <p>Khung nhúng dùng cùng dịch vụ tư vấn và nguồn kiến thức.</p>
              </div>
            </div>
            <div className="panel-padding">
              <p>
                Khung nhúng chỉ tra cứu thông tin công khai. Khi cần hồ sơ riêng, sinh viên mở
                website chính để đăng nhập.
              </p>
              <pre className="code-block">
                {
                  '<script\n  src="https://TEN-MIEN-NAU-AI/widget.js"\n  data-title="Hỏi NAU AI"\n  defer\n></script>'
                }
              </pre>
              <p className="microcopy">
                Thay TEN-MIEN-NAU-AI bằng tên miền HTTPS triển khai thực tế. Khung chat không phụ
                thuộc cookie bên thứ ba.
              </p>
              <Link href="/embed" target="_blank" className="button primary compact">
                Xem khung nhúng <ArrowUpRight size={16} />
              </Link>
            </div>
          </section>
        )}
      </div>
      {(edit || add) && (
        <div className="modal-backdrop">
          <div
            className="modal large"
            role="dialog"
            aria-modal="true"
            aria-labelledby="source-modal-title"
          >
            <button
              className="modal-close icon-button"
              aria-label="Đóng"
              onClick={() => {
                setEdit(null);
                setAdd(false);
              }}
            >
              <X size={20} />
            </button>
            <h2 id="source-modal-title">
              {add ? 'Thêm nguồn chính thức' : 'Duyệt nội dung nguồn'}
            </h2>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {add ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await post('/admin/sources', {
                      ...form,
                      effectiveFrom: form.effectiveFrom || null,
                      admissionAfter: form.admissionAfter || null,
                    });
                    setAdd(false);
                  }, 'Đã thêm nguồn chờ duyệt. Bấm kiểm tra cập nhật để tải tài liệu.');
                }}
              >
                {[
                  { id: 'title', label: 'Tên tài liệu' },
                  { id: 'url', label: 'URL chính thức (HTTPS)' },
                  { id: 'topic', label: 'Chủ đề' },
                ].map((f) => (
                  <label key={f.id}>
                    {f.label}
                    <input
                      required
                      value={form[f.id as keyof typeof form]}
                      onChange={(e) => setForm((v) => ({ ...v, [f.id]: e.target.value }))}
                    />
                  </label>
                ))}
                <label>
                  Loại tài liệu
                  <select
                    value={form.kind}
                    onChange={(e) => setForm((v) => ({ ...v, kind: e.target.value }))}
                  >
                    <option value="html">Trang HTML</option>
                    <option value="pdf">PDF / tài liệu quét</option>
                  </select>
                </label>
                <label>
                  Ngày có hiệu lực (nếu có)
                  <input
                    type="date"
                    value={form.effectiveFrom}
                    onChange={(e) => setForm((v) => ({ ...v, effectiveFrom: e.target.value }))}
                  />
                </label>
                <label>
                  Áp dụng cho tuyển sinh sau ngày (nếu có)
                  <input
                    type="date"
                    value={form.admissionAfter}
                    onChange={(e) => setForm((v) => ({ ...v, admissionAfter: e.target.value }))}
                  />
                </label>
                <button className="button primary full" disabled={busy}>
                  Thêm vào danh sách nguồn
                </button>
              </form>
            ) : (
              edit && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      await post('/admin/sources/' + edit.id + '/approve', {
                        ...review,
                        page: edit.kind === 'pdf' ? Number(review.page) : undefined,
                        confirmedOriginal: true,
                      });
                      setEdit(null);
                    }, 'Đã duyệt phiên bản và cập nhật kho tra cứu.');
                  }}
                >
                  <a href={edit.url} target="_blank" rel="noreferrer" className="ask-link">
                    {edit.title} <ArrowUpRight size={15} />
                  </a>
                  {edit.pendingText && (
                    <details className="raw-source">
                      <summary>Nội dung mới tải về (chưa dùng để trả lời)</summary>
                      <pre>{edit.pendingText}</pre>
                    </details>
                  )}
                  <label>
                    Phiên bản
                    <input
                      required
                      value={review.version}
                      onChange={(e) => setReview((v) => ({ ...v, version: e.target.value }))}
                    />
                  </label>
                  <label>
                    Đoạn nội dung đã kiểm tra
                    <textarea
                      rows={8}
                      required
                      minLength={40}
                      maxLength={20000}
                      value={review.excerpt}
                      onChange={(e) => setReview((v) => ({ ...v, excerpt: e.target.value }))}
                    />
                  </label>
                  {edit.kind === 'pdf' && (
                    <div className="form-grid">
                      <label>
                        Trang PDF
                        <input
                          type="number"
                          min={1}
                          required
                          value={review.page}
                          onChange={(e) => setReview((v) => ({ ...v, page: e.target.value }))}
                        />
                      </label>
                      <label>
                        Điều khoản / mục
                        <input
                          required
                          value={review.article}
                          onChange={(e) => setReview((v) => ({ ...v, article: e.target.value }))}
                        />
                      </label>
                    </div>
                  )}
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    Tôi đã đối chiếu nội dung, phiên bản và phạm vi với bản gốc; đoạn duyệt không
                    chứa hồ sơ cá nhân.
                  </label>
                  <button
                    className="button primary full"
                    disabled={!confirmed || busy || edit.status === 'excluded'}
                  >
                    Duyệt và đưa vào tra cứu
                  </button>
                </form>
              )
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
