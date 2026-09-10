'use client';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  MessageSquare,
  BookOpen,
  LayoutDashboard,
  ShieldCheck,
  Server,
  ArrowUpRight,
  Plus,
  LogOut,
  Menu,
  X,
  ChevronRight,
  PanelLeftClose,
} from 'lucide-react';
import { useApp } from './app-provider';
import { api } from '../lib/api';
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/"
      className={`brand ${compact ? 'brand-compact' : ''}`}
      aria-label="NAU AI — trang chủ"
    >
      <Image
        className="brand-logo"
        src="/brand/nau-logo.png"
        width={320}
        height={160}
        alt=""
        priority
      />
    </Link>
  );
}
export function Shell({
  children,
  title = 'Trợ lý sinh viên',
  eyebrow = 'KHÔNG GIAN TƯ VẤN',
}: {
  children: ReactNode;
  title?: string;
  eyebrow?: string;
}) {
  const path = usePathname(),
    { identity, health, error, logout, loading } = useApp();
  const [open, setOpen] = useState(false),
    [history, setHistory] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    const refresh = () => {
      void api('/conversations')
        .then(setHistory)
        .catch(() => {});
    };
    refresh();
    window.addEventListener('nau:history', refresh);
    return () => window.removeEventListener('nau:history', refresh);
  }, [identity]);
  useEffect(() => setOpen(false), [path]);
  const links = [
    { href: '/', label: 'Trò chuyện', icon: MessageSquare },
    { href: '/student', label: 'Hồ sơ học tập', icon: LayoutDashboard },
    { href: '/knowledge', label: 'Kho kiến thức', icon: BookOpen },
    ...(identity?.role === 'admin'
      ? [
          { href: '/admin', label: 'Quản trị', icon: ShieldCheck },
          { href: '/admin/api-pool', label: 'Pool API & model', icon: Server },
        ]
      : []),
  ];
  return (
    <div className="app-shell">
      <button
        className={`sidebar-scrim ${open ? 'visible' : ''}`}
        aria-label="Đóng menu"
        onClick={() => setOpen(false)}
      />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-top">
          <Brand />
          <button
            className="icon-button mobile-only"
            aria-label="Đóng menu"
            onClick={() => setOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <Link
          href="/"
          onClick={() => window.dispatchEvent(new Event('nau:new-chat'))}
          className="new-chat"
        >
          <Plus size={18} />
          Cuộc trò chuyện mới
        </Link>
        <p className="nav-label">KHÁM PHÁ</p>
        <nav>
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`nav-link ${path === l.href ? 'active' : ''}`}
            >
              <l.icon size={19} />
              {l.label}
              {path === l.href && <span className="nav-dot" />}
            </Link>
          ))}
        </nav>
        <div className="history-section">
          <p className="nav-label">TRÒ CHUYỆN GẦN ĐÂY</p>
          {history.slice(0, 5).map((h) => (
            <Link className="history-item" key={h.id} href={'/?conversation=' + h.id}>
              <MessageSquare size={14} />
              <span>{h.title}</span>
            </Link>
          ))}
          {history.length === 0 && (
            <p className="history-empty">Các cuộc trò chuyện của bạn sẽ xuất hiện ở đây.</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="pilot-note">
            <span className="live-dot" />
            <b>Không gian thử nghiệm</b>
            <p>
              Hồ sơ giả, trải nghiệm thật.
              <br />
              Cùng hoàn thiện trợ lý NAU.
            </p>
            <Link href="/knowledge">
              Tìm hiểu dữ liệu <ArrowUpRight size={14} />
            </Link>
          </div>
          {identity ? (
            <div className="profile-mini">
              <span className="avatar">{identity.role === 'admin' ? 'QT' : 'SV'}</span>
              <div>
                <b>{identity.displayName}</b>
                <small>
                  {identity.role === 'admin' ? 'Quản trị viên' : 'Tài khoản thử nghiệm'}
                </small>
              </div>
              <button className="icon-button" onClick={() => void logout()} aria-label="Đăng xuất">
                <LogOut size={17} />
              </button>
            </div>
          ) : (
            <Link className="guest-login" href="/login">
              <span className="avatar">SV</span>
              <div>
                <b>Không gian của bạn</b>
                <small>Đăng nhập để tra cứu học tập</small>
              </div>
              <ChevronRight size={17} />
            </Link>
          )}
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="icon-button mobile-only"
              aria-label="Mở menu"
              disabled={loading}
              onClick={() => setOpen(true)}
            >
              <Menu size={22} />
            </button>
            <div>
              <span className="eyebrow">{eyebrow}</span>
              <h1>{title}</h1>
            </div>
          </div>
          <div className="topbar-right">
            <span className="demo-badge">
              <span className="live-dot" />
              Bản thử nghiệm
            </span>
            <a href="https://nau.edu.vn/" target="_blank" rel="noreferrer" className="school-link">
              Website trường <ArrowUpRight size={15} />
            </a>
          </div>
        </header>
        {error && <div className="alert error">Chưa kết nối được dịch vụ: {error}</div>}
        <main>{children}</main>
        <footer className="app-footer">
          <span>NAU AI · Đồng hành trên hành trình đại học</span>
          <span>
            {health?.llmProvider === 'evidence'
              ? 'Chưa cấu hình model cho chat'
              : 'Câu trả lời do model AI tạo'}{' '}
            <span className="footer-dot">·</span> Lưu hội thoại {health?.retentionDays || 30} ngày
          </span>
        </footer>
      </div>
    </div>
  );
}
