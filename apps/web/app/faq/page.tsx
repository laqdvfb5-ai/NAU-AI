'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowUpRight, MessageCircleQuestion, Search, LockKeyhole } from 'lucide-react';
import { STUDENT_FAQ_CATEGORIES, STUDENT_FAQ_QUESTIONS, normalize } from '@nau/domain';
import { Shell } from '../../components/shell';
import styles from './page.module.css';

export default function StudentFaqPage() {
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const matches = STUDENT_FAQ_QUESTIONS.filter((entry) => {
    const group = STUDENT_FAQ_CATEGORIES.find((c) => c.id === entry.categoryId)!;
    const text = normalize([entry.question, group.title, ...entry.aliases].join(' '));
    return (
      (category === 'all' || category === entry.categoryId) &&
      terms.every((term) => text.includes(term))
    );
  });

  return (
    <Shell title="Câu hỏi thường gặp" eyebrow="ĐỒNG HÀNH MỖI NGÀY">
      <div className={styles.page}>
        <header className={styles.intro}>
          <span className="section-kicker">TỪ GIẢNG ĐƯỜNG ĐẾN CUỘC SỐNG</span>
          <h1>
            Bạn đang băn khoăn <span>điều gì?</span>
          </h1>
          <p>
            Học phí, giấy tờ, chỗ ở hay những bước đầu vào trường. Chọn một câu hỏi để cùng NAU AI
            tìm hiểu.
          </p>
          <label className={styles.search}>
            <Search size={20} aria-hidden="true" />
            <input
              aria-label="Tìm câu hỏi thường gặp"
              placeholder="Thử tìm: học bổng, bảo lưu, ký túc xá…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </header>
        <div className={styles.layout}>
          <nav className={styles.categories} aria-label="Chủ đề câu hỏi">
            <button aria-pressed={category === 'all'} onClick={() => setCategory('all')}>
              Tất cả chủ đề <span>{STUDENT_FAQ_QUESTIONS.length}</span>
            </button>
            {STUDENT_FAQ_CATEGORIES.map((group) => (
              <button
                key={group.id}
                aria-pressed={category === group.id}
                onClick={() => setCategory(group.id)}
              >
                {group.title}
              </button>
            ))}
          </nav>
          <section className={styles.results} aria-label="Danh sách câu hỏi">
            <div className={styles.note}>
              <MessageCircleQuestion size={20} aria-hidden="true" />
              <p>
                Mỗi câu hỏi mở một bản nháp trong chat. Bạn có thể thêm tình huống của mình trước
                khi gửi. AI sẽ nêu nguồn tham khảo và nói rõ khi chưa đủ thông tin.
              </p>
            </div>
            <p className={styles.count} role="status">
              {matches.length} câu hỏi gợi ý
            </p>
            {STUDENT_FAQ_CATEGORIES.map((group) => {
              const questions = matches.filter((entry) => entry.categoryId === group.id);
              if (!questions.length) return null;
              return (
                <section className={styles.group} key={group.id}>
                  <h2>{group.title}</h2>
                  <p>{group.description}</p>
                  <ul>
                    {questions.map((entry) => (
                      <li key={entry.id}>
                        <Link href={`/?faq=${entry.id}`} prefetch={false}>
                          <span>
                            {entry.question}
                            {entry.dataScope === 'personal' && (
                              <small>
                                <LockKeyhole size={12} aria-hidden="true" /> Tra hồ sơ của bạn sau
                                đăng nhập
                              </small>
                            )}
                          </span>
                          <ArrowUpRight size={18} aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            {!matches.length && (
              <div className={styles.empty}>
                <h2>Chưa thấy câu hỏi phù hợp?</h2>
                <p>Bạn vẫn có thể hỏi bằng lời của mình.</p>
                <Link className="button primary" href="/">
                  Mở cuộc trò chuyện <ArrowUpRight size={16} />
                </Link>
              </div>
            )}
            <Link className={styles.sourceLink} href="/knowledge">
              Xem các nguồn đang có trong kho kiến thức <ArrowUpRight size={15} />
            </Link>
          </section>
        </div>
      </div>
    </Shell>
  );
}
