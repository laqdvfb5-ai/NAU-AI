'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Wallet,
  CalendarDays,
  GraduationCap,
  ShieldCheck,
  ThumbsUp,
  ThumbsDown,
  Copy,
  Check,
  RotateCcw,
  Square,
  Plus,
  Trash2,
} from 'lucide-react';
import type { AcademicResult, Citation } from '@nau/domain';
import { useApp } from './app-provider';
import { Sources, Evaluation } from './evidence';
import { ChatProgress, isProgressStage, type ProgressStep } from './chat-progress';
import progressStyles from './chat-progress.module.css';
import { api, post } from '../lib/api';
type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: Citation[];
  evaluations?: AcademicResult[];
  mode?: string;
  model?: string;
  providerName?: string;
  warning?: string;
  needsLogin?: boolean;
  conversationId?: string;
};

type ChatRequestError = Error & { retryable?: boolean };

function chatRequestError(message: string, retryable: unknown): ChatRequestError {
  const error = new Error(message) as ChatRequestError;
  if (typeof retryable === 'boolean') error.retryable = retryable;
  return error;
}

const suggestions = [
  {
    icon: GraduationCap,
    title: 'Hiểu rõ kết quả học tập',
    description: 'Vì sao điểm đủ mà vẫn chưa qua môn?',
    question: 'Vì sao điểm tổng đủ nhưng học phần cốt lõi vẫn chưa đạt?',
  },
  {
    icon: BookOpen,
    title: 'Tìm đúng quy chế',
    description: 'Điều kiện dự thi và xét đạt học phần',
    question: 'Điều kiện dự thi theo quy chế đào tạo năm 2025 là gì?',
  },
  {
    icon: Wallet,
    title: 'Học phí & học bổng',
    description: 'Tra cứu thông tin và nguồn chính thức',
    question: 'Tôi có thể xem học phí và học bổng hiện hành ở đâu?',
  },
  {
    icon: CalendarDays,
    title: 'Lịch học của bạn',
    description: 'Sắp xếp một học kỳ chủ động hơn',
    question: 'Cho tôi xem lịch học của tôi',
  },
];
export function Chat({ embed = false }: { embed?: boolean }) {
  const params = useSearchParams(),
    { identity, loading } = useApp();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  const [messages, setMessages] = useState<Message[]>([]),
    [input, setInput] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [steps, setSteps] = useState<ProgressStep[]>([]),
    [startedAt, setStartedAt] = useState(0),
    [retryQuestion, setRetryQuestion] = useState(''),
    [historyLoading, setHistoryLoading] = useState(false),
    [partial, setPartial] = useState(''),
    [conversation, setConversation] = useState<string>(),
    [copied, setCopied] = useState(''),
    [rated, setRated] = useState<Record<string, number>>({});
  const bottom = useRef<HTMLDivElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null),
    controller = useRef<AbortController | null>(null),
    requestVersion = useRef(0);
  const conversationParam = params.get('conversation'),
    initialQuestion = params.get('q');
  const invalidateRequest = useCallback(() => {
    requestVersion.current += 1;
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setSteps([]);
    setPartial('');
    setRetryQuestion('');
    setHistoryLoading(false);
  }, []);
  const reset = useCallback(() => {
    invalidateRequest();
    setMessages([]);
    setConversation(undefined);
    setError('');
    setInput('');
    setRated({});
    window.history.replaceState({}, '', embed ? '/embed' : '/');
  }, [embed, invalidateRequest]);
  useEffect(() => {
    window.addEventListener('nau:new-chat', reset);
    return () => {
      window.removeEventListener('nau:new-chat', reset);
      requestVersion.current += 1;
      controller.current?.abort();
    };
  }, [reset]);
  useEffect(() => {
    if (initialQuestion) setInput(initialQuestion.slice(0, 2000));
  }, [initialQuestion]);
  useEffect(() => {
    invalidateRequest();
    setMessages([]);
    setConversation(undefined);
    setError('');
    const version = requestVersion.current;
    const abort = new AbortController();
    if (loading) return () => abort.abort();
    if (conversationParam && !embed) {
      setHistoryLoading(true);
      void api<Message[]>('/conversations/' + conversationParam, { signal: abort.signal })
        .then((data) => {
          if (!abort.signal.aborted && version === requestVersion.current) {
            setMessages(data);
            setConversation(conversationParam);
            setError('');
          }
        })
        .catch((e) => {
          if (!abort.signal.aborted && version === requestVersion.current) {
            setMessages([]);
            setConversation(undefined);
            setError(e.message);
          }
        })
        .finally(() => {
          if (!abort.signal.aborted && version === requestVersion.current) setHistoryLoading(false);
        });
    }
    return () => abort.abort();
  }, [conversationParam, embed, identity?.accountId, loading, invalidateRequest]);
  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    bottom.current?.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'end' });
  }, [messages, busy, steps]);
  async function send(text = input, retry = false) {
    const question = text.trim();
    if (!question || !hydrated || loading || historyLoading || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    const version = ++requestVersion.current;
    const isCurrent = () => version === requestVersion.current && controller.current === abort;
    setInput('');
    setError('');
    setRetryQuestion('');
    setBusy(true);
    setPartial('');
    setStartedAt(Date.now());
    setSteps([{ stage: 'connecting', message: 'Đang kết nối với dịch vụ tư vấn…' }]);
    setMessages((m) =>
      retry && m.at(-1)?.role === 'user' && m.at(-1)?.text === question
        ? m
        : [...m, { id: crypto.randomUUID(), role: 'user', text: question }],
    );
    try {
      const response = await fetch('/api/v1/chat', {
        method: 'POST',
        credentials: embed ? 'omit' : 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: question,
          ...(conversation ? { conversationId: conversation } : {}),
          ...(embed ? { embed: true } : {}),
        }),
        signal: abort.signal,
      });
      if (!isCurrent()) return;
      if (!response.ok) {
        const e = await response.json().catch(() => ({}));
        throw chatRequestError(e.message || 'Không kết nối được dịch vụ.', e.retryable);
      }
      if (!response.body) throw new Error('Trình duyệt không hỗ trợ phản hồi trực tiếp.');
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (!isCurrent()) return;
        abort.signal.throwIfAborted();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const event = block.match(/^event: (.+)$/m)?.[1],
            raw = block.match(/^data: (.+)$/m)?.[1];
          if (!raw) continue;
          const data = JSON.parse(raw);
          if (
            event === 'status' &&
            isProgressStage(data.stage) &&
            typeof data.message === 'string'
          ) {
            const step: ProgressStep = { stage: data.stage, message: data.message };
            setSteps((previous) =>
              previous.at(-1)?.stage === step.stage
                ? [...previous.slice(0, -1), step]
                : [...previous, step],
            );
          }
          if (event === 'delta' && typeof data.text === 'string') setPartial((p) => p + data.text);
          if (event === 'error')
            throw chatRequestError(
              data.message || 'AI chưa hoàn tất phản hồi. Vui lòng thử lại.',
              data.retryable,
            );
          if (event === 'answer') {
            setMessages((m) => [...m, data]);
            if (data.conversationId) setConversation(data.conversationId);
            window.dispatchEvent(new Event('nau:history'));
            await reader.cancel().catch(() => {});
            return;
          }
        }
      }
      throw new Error('Phản hồi bị gián đoạn. Vui lòng thử lại.');
    } catch (e) {
      if (!isCurrent()) return;
      const requestError = e as ChatRequestError;
      if (requestError.name !== 'AbortError') setError(requestError.message);
      else setError('Đã dừng yêu cầu. Bạn có thể gửi lại câu hỏi.');
      setRetryQuestion(requestError.retryable === false ? '' : question);
    } finally {
      if (isCurrent()) {
        setBusy(false);
        setSteps([]);
        setPartial('');
        controller.current = null;
        textarea.current?.focus();
      }
    }
  }
  async function rate(message: Message, value: number) {
    try {
      await post('/feedback', {
        conversationId: message.conversationId || conversation,
        messageId: message.id,
        rating: value,
      });
      setRated((r) => ({ ...r, [message.id]: value }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function remove() {
    if (!conversation) return;
    try {
      await api('/conversations/' + conversation, { method: 'DELETE' });
      reset();
      window.dispatchEvent(new Event('nau:history'));
      window.history.replaceState({}, '', '/');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section
      className={`chat-page ${embed ? 'embedded-chat' : ''} ${messages.length ? 'has-messages' : ''}`}
    >
      {!messages.length ? (
        <div className="chat-welcome">
          <div className="welcome-tag">
            <span className="tiny-star">✦</span> MỘT NGƯỜI BẠN, NHIỀU LỜI GIẢI ĐÁP
          </div>
          <div className="welcome-mark">
            <Sparkles size={32} />
            <span className="orbit-dot" />
          </div>
          <h2>
            Chào bạn,
            <br />
            hôm nay mình có thể <em>giúp gì?</em>
          </h2>
          <p className="welcome-description">
            Từ những thắc mắc về nhà trường đến hành trình học tập của bạn.
            <br className="desktop-only" /> Cùng NAU AI tìm câu trả lời rõ ràng, có căn cứ.
          </p>
          <div className="suggestion-grid">
            {suggestions.map((s) => (
              <button
                className="suggestion-card"
                disabled={!hydrated || loading || historyLoading}
                onClick={() => void send(s.question)}
                key={s.title}
              >
                <span className="suggestion-icon">
                  <s.icon size={22} />
                </span>
                <ArrowUpRight className="suggestion-arrow" size={17} />
                <strong>{s.title}</strong>
                <p>{s.description}</p>
              </button>
            ))}
          </div>
          <div className="trust-line">
            <ShieldCheck size={15} />
            <span>Câu trả lời gắn với nguồn · Dữ liệu riêng cần đăng nhập</span>
          </div>
        </div>
      ) : (
        <div className="conversation">
          <div className="conversation-heading">
            <span>
              <span className="live-dot" /> Cuộc trò chuyện với NAU AI
            </span>
            <div>
              <button className="icon-button" aria-label="Cuộc trò chuyện mới" onClick={reset}>
                <Plus size={18} />
              </button>
              {conversation && (
                <button
                  className="icon-button"
                  aria-label="Xóa cuộc trò chuyện này"
                  onClick={() => void remove()}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </div>
          {messages.map((m) => (
            <article key={m.id} className={'message ' + m.role}>
              {m.role === 'assistant' && (
                <span className="assistant-avatar">
                  <Sparkles size={19} />
                </span>
              )}
              <div className="message-content">
                {m.role === 'assistant' && (
                  <div className="message-author">
                    NAU AI{' '}
                    <span>
                      {m.mode === 'evidence'
                        ? 'Tra cứu có căn cứ'
                        : m.mode === 'conversation'
                          ? 'Trò chuyện'
                          : 'AI model'}
                    </span>
                    {identity?.role === 'admin' && m.providerName && (
                      <span title={m.model}>
                        {m.providerName} · {m.model}
                      </span>
                    )}
                  </div>
                )}
                {m.warning && <div className="alert">{m.warning}</div>}
                <div className="message-text">{m.text}</div>
                {m.evaluations?.map((e) => (
                  <Evaluation key={e.recordId} result={e} />
                ))}
                {!!m.citations?.length && (
                  <>
                    <div className="source-label">
                      <BookOpen size={13} /> Nguồn tham khảo
                    </div>
                    <Sources sources={m.citations} />
                  </>
                )}
                {m.needsLogin && (
                  <Link
                    className="button primary compact"
                    target={embed ? '_blank' : undefined}
                    href="/login"
                  >
                    Đăng nhập để tra cứu <ArrowUpRight size={15} />
                  </Link>
                )}
                {m.role === 'assistant' && (
                  <div className="message-tools">
                    <button
                      className="icon-button"
                      aria-label="Sao chép câu trả lời"
                      onClick={() => {
                        void navigator.clipboard.writeText(m.text).then(() => {
                          setCopied(m.id);
                          setTimeout(() => setCopied(''), 2000);
                        });
                      }}
                    >
                      {copied === m.id ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    {!embed && (
                      <>
                        <button
                          className={`icon-button ${rated[m.id] === 1 ? 'selected' : ''}`}
                          aria-label="Câu trả lời hữu ích"
                          onClick={() => void rate(m, 1)}
                        >
                          <ThumbsUp size={14} />
                        </button>
                        <button
                          className={`icon-button ${rated[m.id] === -1 ? 'selected' : ''}`}
                          aria-label="Câu trả lời cần cải thiện"
                          onClick={() => void rate(m, -1)}
                        >
                          <ThumbsDown size={14} />
                        </button>
                        {rated[m.id] && <small>Đã ghi nhận góp ý</small>}
                      </>
                    )}
                  </div>
                )}
              </div>
            </article>
          ))}
          {busy && <ChatProgress steps={steps} startedAt={startedAt} />}
          {busy && partial && (
            <div className="stream-preview">
              <span className="message-author">NAU AI · Đang tạo câu trả lời</span>
              <div className="message-text">{partial}</div>
            </div>
          )}
          <div ref={bottom} />
        </div>
      )}
      <div className="composer-area">
        {error && (
          <div className={`alert error ${progressStyles.error}`} role="alert">
            <span>{error}</span>
            {retryQuestion && !busy && (
              <button
                type="button"
                className={progressStyles.retry}
                disabled={loading || historyLoading}
                onClick={() => void send(retryQuestion, true)}
              >
                <RotateCcw size={14} aria-hidden="true" /> Thử lại
              </button>
            )}
          </div>
        )}
        {!identity && !embed && messages.length === 0 && (
          <p className="login-nudge">
            <Link href="/login">Đăng nhập</Link> để tra cứu điểm, lịch học và học phí của riêng bạn{' '}
            <ArrowUpRight size={13} />
          </p>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="sr-only" htmlFor="chat-input">
            Câu hỏi của bạn
          </label>
          <textarea
            ref={textarea}
            id="chat-input"
            disabled={!hydrated || loading || historyLoading}
            value={input}
            maxLength={2000}
            rows={2}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Hỏi NAU AI một điều bạn đang băn khoăn…"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="composer-bottom">
            <span>
              <span className="live-dot" />
              {embed
                ? 'Tư vấn thông tin công khai'
                : identity
                  ? 'Đã kết nối hồ sơ thử nghiệm'
                  : 'Sẵn sàng lắng nghe'}
            </span>
            {busy ? (
              <button
                type="button"
                className="send-button"
                aria-label="Dừng trả lời"
                onClick={() => controller.current?.abort()}
              >
                <Square size={15} />
              </button>
            ) : (
              <button
                type="submit"
                className="send-button"
                disabled={loading || historyLoading || !input.trim()}
                aria-label="Gửi câu hỏi"
              >
                <ArrowUp size={21} />
              </button>
            )}
          </div>
        </form>
        <p className="composer-disclaimer">
          Bản thử nghiệm dùng dữ liệu giả. Hãy kiểm tra nguồn và kết quả chính thức khi cần quyết
          định học vụ.
        </p>
      </div>
    </section>
  );
}
