'use client';
import { useEffect, useState } from 'react';
import { BookOpen, Search, ArrowUpRight, ShieldCheck, FileText, Clock3, Link2 } from 'lucide-react';
import { Shell } from '../../components/shell';
import { api, date } from '../../lib/api';
type Source = {
  id: string;
  title: string;
  url: string;
  version: string;
  updatedAt: string;
  status: string;
  topic: string;
  excerpt: string;
  page?: number;
  article?: string;
  admissionAfter?: string;
};
export default function Knowledge() {
  const [sources, setSources] = useState<Source[]>([]),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [error, setError] = useState('');
  useEffect(() => {
    void api('/sources')
      .then(setSources)
      .catch((e) => setError(e.message));
  }, []);
  const active = sources.filter((s) => s.status === 'active');
  const matches = sources.filter(
    (s) =>
      (filter === 'all' || (filter === 'active' ? s.status === 'active' : s.status !== 'active')) &&
      [s.title, s.topic, s.excerpt].join(' ').toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Shell title="Kho kiến thức" eyebrow="THÔNG TIN CÓ CĂN CỨ">
      <div className="page-content">
        <div className="page-intro">
          <div>
            <span className="section-kicker">BIẾT NGUỒN, HIỂU ĐÚNG</span>
            <h2>
              Mỗi câu trả lời, một căn cứ<span className="heading-dot">.</span>
            </h2>
            <p>Khám phá những nguồn chính thức đang được NAU AI sử dụng.</p>
          </div>
          <div className="source-count">
            <b>{active.length.toString().padStart(2, '0')}</b>
            <span>nguồn đang dùng</span>
          </div>
        </div>
        <div className="knowledge-banner">
          <span className="banner-icon">
            <ShieldCheck size={28} />
          </span>
          <div>
            <h3>Minh bạch về những gì mình biết</h3>
            <p>
              Kho thử nghiệm chưa bao phủ toàn bộ thông tin nhà trường. Văn bản được theo dõi theo
              phiên bản và đối tượng áp dụng; nguồn thiếu hoặc chưa duyệt sẽ không dùng để kết luận.
            </p>
          </div>
          <div className="banner-seal">
            <BookOpen size={46} />
          </div>
        </div>
        <div className="filter-bar">
          <div className="filter-chips">
            {[
              { id: 'all', label: 'Tất cả nguồn' },
              { id: 'active', label: 'Đang sử dụng' },
              { id: 'pending', label: 'Cần bổ sung' },
            ].map((f) => (
              <button
                key={f.id}
                className={filter === f.id ? 'active' : ''}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className="search-field">
            <Search size={17} />
            <input
              placeholder="Tìm quy chế, chủ đề…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Tìm nguồn kiến thức"
            />
          </label>
        </div>
        {error && <div className="alert error">{error}</div>}
        <div className="source-grid">
          {matches.map((s) => (
            <article
              className={'source-card ' + (s.status === 'active' ? '' : 'pending-source')}
              key={s.id}
            >
              <div className="source-card-top">
                <span className="document-icon">
                  {s.url.includes('.pdf') ? <FileText size={23} /> : <Link2 size={23} />}
                </span>
                <span
                  className={'status-pill ' + (s.status === 'active' ? 'passed' : 'insufficient')}
                >
                  {s.status === 'active'
                    ? 'Đang sử dụng'
                    : s.status === 'pending'
                      ? 'Chưa duyệt'
                      : 'Chưa khả dụng'}
                </span>
              </div>
              <span className="source-topic">{s.topic}</span>
              <h3>{s.title}</h3>
              <p>{s.excerpt}</p>
              {s.admissionAfter && (
                <div className="source-scope">
                  Tuyển sinh sau {date(s.admissionAfter)}
                  <br />
                  {s.article}
                </div>
              )}
              <div className="source-card-bottom">
                <span>
                  <Clock3 size={13} />
                  {date(s.updatedAt)}
                </span>
                <a
                  href={s.url + (s.page ? '#page=' + s.page : '')}
                  target="_blank"
                  rel="noreferrer"
                >
                  Xem nguồn gốc <ArrowUpRight size={15} />
                </a>
              </div>
              <small className="source-version">{s.version}</small>
            </article>
          ))}
        </div>
        {!matches.length && (
          <div className="empty-state small">
            <Search size={30} />
            <h3>Chưa tìm thấy nguồn phù hợp</h3>
            <p>Thử tìm theo một chủ đề khác hoặc bỏ bộ lọc.</p>
          </div>
        )}
        <div className="knowledge-footnote">
          <ShieldCheck size={18} />
          <p>
            Danh sách điểm và hồ sơ cá nhân công khai trên website trường không thuộc kho hỏi đáp
            này. Đề cương, quy chế và dữ liệu dùng cho kết luận thực tế cần được nhà trường xác nhận
            trước khi vận hành.
          </p>
        </div>
      </div>
    </Shell>
  );
}
