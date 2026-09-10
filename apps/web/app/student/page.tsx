'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  BookOpen,
  GraduationCap,
  Wallet,
  CalendarDays,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Clock3,
  X,
} from 'lucide-react';
import type { Student, AcademicResult, ActionDefinition } from '@nau/domain';
import { Shell } from '../../components/shell';
import { Evaluation, statusLabels } from '../../components/evidence';
import { useApp } from '../../components/app-provider';
import { api, post, money, date } from '../../lib/api';
export default function StudentPage() {
  const { identity, loading } = useApp(),
    [student, setStudent] = useState<Student | null>(null),
    [results, setResults] = useState<AcademicResult[]>([]),
    [actions, setActions] = useState<ActionDefinition[]>([]),
    [tab, setTab] = useState('learning'),
    [selected, setSelected] = useState<string>(),
    [error, setError] = useState(''),
    [action, setAction] = useState<ActionDefinition | null>(null),
    [actionResult, setActionResult] = useState('');
  useEffect(() => {
    let active = true;
    if (identity?.role === 'student')
      void Promise.all([api<Student>('/me'), api('/me/academics'), api('/actions')])
        .then(([s, r, a]) => {
          if (active) {
            setStudent(s);
            setResults(r.evaluations);
            setActions(a);
            setSelected(s.courses[0].id);
          }
        })
        .catch((e) => active && setError(e.message));
    else {
      setStudent(null);
      setResults([]);
    }
    return () => {
      active = false;
    };
  }, [identity]);
  if (!identity && !loading)
    return (
      <Shell title="Hồ sơ học tập" eyebrow="KHÔNG GIAN CỦA BẠN">
        <div className="empty-state">
          <div className="empty-icon">
            <ShieldCheck size={36} />
          </div>
          <span className="section-kicker">RIÊNG TƯ VÀ CÁ NHÂN</span>
          <h2>Hiểu rõ hành trình học tập của bạn</h2>
          <p>
            Đăng nhập để xem điểm, lịch học, học phí và giải thích học vụ.
            <br />
            Mỗi tài khoản chỉ truy cập được hồ sơ của chính mình.
          </p>
          <Link href="/login" className="button primary">
            Đăng nhập thử nghiệm <ArrowUpRight size={17} />
          </Link>
        </div>
      </Shell>
    );
  if (identity?.role === 'admin')
    return (
      <Shell title="Hồ sơ học tập">
        <div className="empty-state">
          <ShieldCheck size={35} />
          <h2>Tài khoản quản trị</h2>
          <p>Hãy dùng tài khoản sinh viên thử nghiệm để xem hồ sơ cá nhân.</p>
          <Link href="/admin" className="button primary">
            Mở trang quản trị
          </Link>
        </div>
      </Shell>
    );
  if (!student)
    return (
      <Shell title="Hồ sơ học tập">
        <div className="loading-state">{error || 'Đang tải hồ sơ của bạn…'}</div>
      </Shell>
    );
  const debt = student.finance.charges.reduce((s, c) => s + c.amount - c.paid, 0),
    unmet = results.filter((r) => r.recordedStatus === 'failed').length;
  return (
    <Shell title="Hồ sơ học tập" eyebrow="KHÔNG GIAN CỦA BẠN">
      <div className="page-content">
        <div className="page-intro">
          <div>
            <span className="section-kicker">MỘT GÓC NHÌN RÕ RÀNG HƠN</span>
            <h2>
              Hành trình học tập của bạn<span className="heading-dot">.</span>
            </h2>
            <p>
              {student.major} <span className="separator">/</span> {student.classCode}{' '}
              <span className="separator">/</span> Khóa {student.cohort}
            </p>
          </div>
          <span className="soft-badge">{student.id} · Dữ liệu giả</span>
        </div>
        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-label">
              <GraduationCap size={18} /> GPA tích lũy
            </span>
            <strong>
              {student.progress.gpa.toFixed(2)}
              <small>/ 4.0</small>
            </strong>
            <p>Theo hồ sơ đang ghi nhận</p>
          </div>
          <div className="stat-card">
            <span className="stat-label">
              <BookOpen size={18} /> Tín chỉ tích lũy
            </span>
            <strong>
              {student.progress.earnedCredits}
              <small>/ {student.progress.requiredCredits}</small>
            </strong>
            <div className="progress-track">
              <span
                style={{
                  width:
                    (100 * student.progress.earnedCredits) / student.progress.requiredCredits + '%',
                }}
              />
            </div>
          </div>
          <div className="stat-card">
            <span className="stat-label">
              <AlertCircle size={18} /> Học phần chưa đạt
            </span>
            <strong>
              {unmet.toString().padStart(2, '0')}
              <small>học phần</small>
            </strong>
            <p>Trong các học phần được mô phỏng</p>
          </div>
          <div className="stat-card">
            <span className="stat-label">
              <Wallet size={18} /> Học phí còn lại
            </span>
            <strong className="money-stat">{money(debt)}</strong>
            <p>Khoản thu giả lập · Kỳ 2026-1</p>
          </div>
        </div>
        <div className="tabs" role="tablist" aria-label="Thông tin sinh viên">
          {[
            { id: 'learning', label: 'Kết quả học tập' },
            { id: 'schedule', label: 'Lịch học & lịch thi' },
            { id: 'finance', label: 'Tài chính & rèn luyện' },
            { id: 'progress', label: 'Tiến độ & thủ tục' },
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
        {tab === 'learning' && (
          <div className="academic-layout">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h3>Điểm số kể điều gì?</h3>
                  <p>Chọn học phần để xem căn cứ và điều kiện xét đạt.</p>
                </div>
                <span className="soft-badge">Học kỳ I · 2026–2027</span>
              </div>
              <div className="table-scroll">
                <table className="course-table">
                  <thead>
                    <tr>
                      <th>Học phần</th>
                      <th>Điểm</th>
                      <th>Đối chiếu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {student.courses.map((c, i) => (
                      <tr key={c.id} className={selected === c.id ? 'selected' : ''}>
                        <td>
                          <button onClick={() => setSelected(c.id)}>
                            <b>{c.course.name}</b>
                            <small>
                              {c.course.id} · {c.course.credits} tín chỉ{' '}
                              {c.course.isCore ? '· Cốt lõi' : ''}
                            </small>
                          </button>
                        </td>
                        <td>
                          <strong className="score-number">
                            {c.total?.toFixed(1).replace('.', ',') ?? '—'}
                          </strong>
                          <small>{c.letter || 'Chưa chốt'}</small>
                        </td>
                        <td>
                          <span className={'status-pill ' + results[i]?.status}>
                            {statusLabels[results[i]?.status] || 'Đang kiểm tra'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="panel-foot">
                <ShieldCheck size={15} />
                <span>Phân loại và đề cương học phần là giả lập, chưa được trường xác nhận.</span>
              </div>
            </section>
            <aside className="academic-explanation">
              <div className="explanation-heading">
                <span className="section-kicker">HIỂU KẾT QUẢ CỦA BẠN</span>
                <h3>Căn cứ xét học phần</h3>
              </div>
              {results
                .filter((r) => r.recordId === selected)
                .map((r) => (
                  <Evaluation key={r.recordId} result={r} expanded />
                ))}
              <Link
                className="ask-link"
                href={
                  '/?q=' +
                  encodeURIComponent(
                    'Giải thích điểm của tôi môn ' +
                      (student.courses.find((c) => c.id === selected)?.course.name || ''),
                  )
                }
              >
                Trao đổi thêm với NAU AI <ArrowUpRight size={16} />
              </Link>
            </aside>
          </div>
        )}
        {tab === 'schedule' && (
          <div className="schedule-layout">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h3>Lịch học trong tuần</h3>
                  <p>Lịch mẫu của học kỳ I · 2026–2027</p>
                </div>
                <CalendarDays size={21} />
              </div>
              <div className="schedule-list">
                {student.timetable
                  .filter((t) => t.kind === 'class')
                  .map((t) => (
                    <div className="schedule-item" key={t.id}>
                      <div className="day-box">
                        <small>THỨ</small>
                        <b>{t.day}</b>
                      </div>
                      <div>
                        <h4>{t.courseName}</h4>
                        <p>
                          <Clock3 size={14} />
                          {t.start}–{t.end}
                          <span>·</span>Phòng {t.room}
                        </p>
                        <small>{t.teacher}</small>
                      </div>
                      <span className="soft-badge">Lớp học</span>
                    </div>
                  ))}
              </div>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h3>Lịch thi</h3>
                  <p>Thông tin thi được mô phỏng</p>
                </div>
              </div>
              {student.timetable
                .filter((t) => t.kind === 'exam')
                .map((t) => (
                  <div key={t.id} className="exam-card">
                    <span className="section-kicker">{t.date && date(t.date)}</span>
                    <h3>{t.courseName}</h3>
                    <p>
                      {t.start}–{t.end} · Phòng {t.room}
                    </p>
                    <div className="alert">
                      Đối chiếu lịch thi chính thức trên cổng sinh viên trước khi dự thi.
                    </div>
                  </div>
                ))}
            </section>
          </div>
        )}
        {tab === 'finance' && (
          <div className="schedule-layout">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h3>Các khoản thu</h3>
                  <p>Dữ liệu giả · không phải biểu học phí của trường</p>
                </div>
                <Wallet size={21} />
              </div>
              {student.finance.charges.map((c) => (
                <div className="finance-card" key={c.id}>
                  <h4>{c.title}</h4>
                  <dl>
                    <div>
                      <dt>Phải thu</dt>
                      <dd>{money(c.amount)}</dd>
                    </div>
                    <div>
                      <dt>Đã thanh toán</dt>
                      <dd>{money(c.paid)}</dd>
                    </div>
                    <div className="debt-row">
                      <dt>Còn lại</dt>
                      <dd>{money(c.amount - c.paid)}</dd>
                    </div>
                    <div>
                      <dt>Hạn thanh toán</dt>
                      <dd>{date(c.dueDate)}</dd>
                    </div>
                  </dl>
                </div>
              ))}
              <div className="panel-foot">
                Học bổng/miễn giảm:{' '}
                {student.finance.scholarships.length
                  ? 'Có khoản ghi nhận'
                  : 'Chưa có khoản ghi nhận trong hồ sơ giả.'}
              </div>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h3>Điểm rèn luyện</h3>
                  <p>Theo học kỳ</p>
                </div>
              </div>
              {student.conduct.map((c) => (
                <div className="conduct-card" key={c.semester}>
                  <div className="conduct-score">
                    {c.score}
                    <small>/100</small>
                  </div>
                  <h4>Học kỳ {c.semester}</h4>
                  <p>{c.status}</p>
                </div>
              ))}
            </section>
          </div>
        )}
        {tab === 'progress' && (
          <div className="schedule-layout">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h3>Tiến độ tốt nghiệp</h3>
                  <p>Chương trình {student.programVersion}</p>
                </div>
              </div>
              <div className="panel-padding">
                <div className="alert">
                  Chương trình và chuẩn tốt nghiệp chưa xác minh. Chưa đủ căn cứ kết luận đủ điều
                  kiện tốt nghiệp.
                </div>
                {student.progress.certificates.map((c) => (
                  <div className="certificate-row" key={c.name}>
                    {c.completed ? <CheckCircle2 size={19} /> : <Clock3 size={19} />}
                    <span>{c.name}</span>
                    <small>{c.completed ? 'Đã hoàn thành' : 'Chưa hoàn thành'}</small>
                  </div>
                ))}
                <p className="microcopy">
                  Môn tiên quyết, tương đương, CLO/PI/PLO và lần học/lần thi được lưu trong hồ sơ mô
                  phỏng để chuẩn bị ánh xạ API thật.
                </p>
              </div>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h3>Thủ tục & tác vụ</h3>
                  <p>Chuẩn bị cho kết nối nhà trường</p>
                </div>
              </div>
              <div className="panel-padding">
                {actions.map((a) => (
                  <button
                    key={a.id}
                    className="action-row"
                    onClick={() => {
                      setAction(a);
                      setActionResult('');
                    }}
                  >
                    <div>
                      <b>{a.name}</b>
                      <small>Chưa có kết nối xử lý</small>
                    </div>
                    <ArrowUpRight size={17} />
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
      {action && (
        <div className="modal-backdrop" onClick={() => setAction(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="action-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Đóng"
              onClick={() => setAction(null)}
            >
              <X size={19} />
            </button>
            <ShieldCheck size={30} />
            <h2 id="action-title">{action.name}</h2>
            <p>{action.description}</p>
            <div className="alert">
              Tác vụ chưa có bộ xử lý. Không thể đăng ký, hủy môn hoặc gửi hồ sơ trong phiên bản
              này.
            </div>
            {actionResult && <p role="status">{actionResult}</p>}
            <button
              className="button secondary full"
              onClick={() =>
                void post('/actions/' + action.id + '/prepare')
                  .then((r) => setActionResult(r.reason))
                  .catch((e) => setActionResult(e.message))
              }
            >
              Kiểm tra khả năng thực hiện
            </button>
            <button className="button primary full" disabled>
              Xác nhận thực hiện · Chưa khả dụng
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}
