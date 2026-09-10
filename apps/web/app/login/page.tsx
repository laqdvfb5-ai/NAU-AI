'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, ShieldCheck, GraduationCap, ArrowLeft, LoaderCircle } from 'lucide-react';
import { Brand } from '../../components/shell';
import { useApp } from '../../components/app-provider';
import { post } from '../../lib/api';
export default function Login() {
  const { health, refresh, loading } = useApp(),
    router = useRouter();
  const [username, setUsername] = useState('sv007'),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const s = await post('/auth/login', { username, password });
      await refresh();
      router.push(s.identity.role === 'admin' ? '/admin' : '/student');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <section className="login-art">
        <Brand />
        <div className="login-art-copy">
          <span className="welcome-tag">HIỂU BẠN HƠN, ĐỒNG HÀNH TỐT HƠN</span>
          <h1 className="login-headline">
            <span>Mỗi hành trình</span>
            <span>đều cần một</span>
            <em>người đồng hành.</em>
          </h1>
          <p>
            Kết nối với không gian học tập của bạn.
            <br />
            Những con số sẽ trở nên dễ hiểu hơn.
          </p>
          <div className="login-illustration">
            <div className="illus-orbit" />
            <div className="illus-orbit second" />
            <GraduationCap size={90} />
            <span className="floating-note">Điểm số có lời giải ✦</span>
            <span className="floating-note second">Học tập có định hướng</span>
          </div>
        </div>
        <small>TRƯỜNG ĐẠI HỌC NGHỆ AN · NAU AI</small>
      </section>
      <section className="login-form-side">
        <div className="login-mobile-brand">
          <Brand compact />
        </div>
        <Link className="back-link" href="/">
          <ArrowLeft size={16} /> Trở về trò chuyện
        </Link>
        <div className="login-form-wrap">
          <span className="section-kicker">KHÔNG GIAN CỦA BẠN</span>
          <h2>Chào mừng bạn trở lại</h2>
          <p>Đăng nhập để xem và hiểu rõ hồ sơ học tập.</p>
          <div className="alert">
            <ShieldCheck size={19} />
            <span>Đây là tài khoản thử nghiệm. Không dùng mật khẩu cổng sinh viên của trường.</span>
          </div>
          <form onSubmit={submit}>
            <label htmlFor="username">Tên đăng nhập</label>
            <input
              id="username"
              disabled={loading || busy}
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              maxLength={60}
            />
            <label htmlFor="password">Mật khẩu</label>
            <input
              id="password"
              disabled={loading || busy}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              maxLength={200}
            />
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button primary full"
              disabled={loading || busy || health?.demoLogin === false}
            >
              {busy ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <>
                  Đăng nhập <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          {health?.demoLogin && (
            <div className="demo-accounts">
              <b>Dùng hồ sơ giả để khám phá</b>
              <p>
                {health.demoPasswordPreset ? (
                  <>
                    Mật khẩu sinh viên mặc định: <code>NauDemo2026!</code>
                  </>
                ) : (
                  'Mật khẩu thử nghiệm do quản trị viên cung cấp.'
                )}
              </p>
              <div>
                {[
                  { id: 'sv007', label: 'CNTT · Điểm 6,2, PI chưa đạt' },
                  { id: 'sv019', label: 'CNTT · Đủ điều kiện' },
                  { id: 'sv031', label: 'CNTT · Thiếu dữ liệu PI' },
                  { id: 'sv001', label: 'CNTT · Quy chế chuyển tiếp' },
                ].map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setUsername(a.id);
                      setPassword(health.demoPasswordPreset ? 'NauDemo2026!' : '');
                    }}
                  >
                    <span>{a.id}</span>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {health?.ssoConfigured ? (
            <a className="button secondary full" href="/api/v1/auth/oidc">
              Đăng nhập SSO nhà trường
            </a>
          ) : (
            <p className="microcopy center">SSO nhà trường sẽ có sau khi kết nối chính thức.</p>
          )}
        </div>
      </section>
    </div>
  );
}
