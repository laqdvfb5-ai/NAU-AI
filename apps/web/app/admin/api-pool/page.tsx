'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Server,
  Plus,
  ArrowUpRight,
  ArrowLeft,
  Play,
  Square,
  CheckCircle2,
  AlertCircle,
  Clock3,
  KeyRound,
  Trash2,
  Pencil,
  RefreshCw,
  X,
  ShieldCheck,
  LoaderCircle,
  Shuffle,
  SlidersHorizontal,
  Globe,
  Monitor,
  Wallet,
  Activity,
} from 'lucide-react';
import type {
  ApiProfile,
  ApiProfileConfig,
  ApiPoolPreset,
  ApiPoolRouting,
  ApiProfileMetrics,
  ApiTestResult,
} from '@nau/domain';
import { Shell } from '../../../components/shell';
import { useApp } from '../../../components/app-provider';
import { api, post } from '../../../lib/api';
type Overview = {
  profiles: ApiProfile[];
  routing: ApiPoolRouting;
  presets: ApiPoolPreset[];
  localOnly: boolean;
  environmentProvider: string;
  metrics: ApiProfileMetrics[];
  budgetUsd: number;
  maxRequestCostUsd: number;
};
const fresh = (): ApiProfileConfig => ({
  name: 'OpenAI',
  preset: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  network: 'cloud',
  auth: 'bearer',
  enabled: true,
  timeoutMs: 25000,
  maxOutputTokens: 1200,
  maxConcurrent: 5,
  inputUsdPerMillion: 0,
  outputUsdPerMillion: 0,
  pricesConfirmed: false,
  tokenParameter: 'max_completion_tokens',
  includeUsage: true,
  sendStore: true,
});
const initialRouting: ApiPoolRouting = {
  enabled: false,
  strategy: 'manual',
  simple: [],
  complex: [],
};
const usd = (n: number) => '$' + n.toFixed(6);
export default function ApiPoolPage() {
  const { identity, loading, refresh: refreshApp } = useApp();
  const [data, setData] = useState<Overview | null>(null),
    [routing, setRouting] = useState<ApiPoolRouting>(initialRouting),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(''),
    [editing, setEditing] = useState<ApiProfile | null>(null),
    [editorOpen, setEditorOpen] = useState(false),
    [form, setForm] = useState<ApiProfileConfig>(fresh),
    [key, setKey] = useState(''),
    [clearKey, setClearKey] = useState(false),
    [formError, setFormError] = useState(''),
    [modelLists, setModelLists] = useState<Record<string, { id: string; ownedBy: string }[]>>({}),
    [testId, setTestId] = useState(''),
    [question, setQuestion] = useState(
      'Vì sao học phần cốt lõi có điểm tổng 6,2 mà vẫn chưa đạt khi PI2.1 là F?',
    ),
    [result, setResult] = useState<ApiTestResult | null>(null),
    [partial, setPartial] = useState(''),
    [deleting, setDeleting] = useState<ApiProfile | null>(null);
  const controller = useRef<AbortController | null>(null);
  async function refresh(preserveRouting = false) {
    const value = await api<Overview>('/admin/api-pool');
    setData(value);
    if (!preserveRouting) setRouting(value.routing);
    setTestId((id) => (value.profiles.some((p) => p.id === id) ? id : value.profiles[0]?.id || ''));
  }
  useEffect(() => {
    if (identity?.role === 'admin') void refresh().catch((e) => setError(e.message));
    return () => controller.current?.abort();
  }, [identity]);
  async function run(id: string, fn: () => Promise<unknown>, message: string) {
    setBusy(id);
    setError('');
    setNotice('');
    try {
      await fn();
      await refresh();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  function openEditor(profile?: ApiProfile) {
    setEditing(profile || null);
    if (profile) {
      const {
        id,
        revision,
        ready,
        hasKey,
        createdAt,
        updatedAt,
        lastTest,
        inFlight,
        cooldownUntil,
        ...config
      } = profile;
      setForm(config);
    } else setForm(fresh());
    setKey('');
    setClearKey(false);
    setFormError('');
    setEditorOpen(true);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy('save');
    setFormError('');
    try {
      const body = {
        ...form,
        ...(key ? { apiKey: key } : {}),
        ...(clearKey ? { clearKey: true } : {}),
        ...(editing ? { revision: editing.revision } : {}),
      };
      if (editing)
        await api('/admin/api-pool/profiles/' + editing.id, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      else await post('/admin/api-pool/profiles', body);
      setKey('');
      setEditorOpen(false);
      await refresh();
      setNotice('Đã lưu cấu hình. Tải danh sách model hoặc gửi thử để kiểm tra kết nối.');
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function models(profile: ApiProfile) {
    setBusy('models:' + profile.id);
    setError('');
    try {
      const response = await post<{
        models: { id: string; ownedBy: string }[];
        latencyMs: number;
        message: string;
      }>('/admin/api-pool/profiles/' + profile.id + '/models');
      setModelLists((v) => ({ ...v, [profile.id]: response.models }));
      setNotice(
        `Nhận ${response.models.length} model từ ${profile.name} trong ${response.latencyMs} ms. Chọn “Sửa” để chọn model và lưu.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function sendTest() {
    if (!testId || busy) return;
    setBusy('test');
    setResult(null);
    setPartial('');
    setError('');
    setNotice('');
    const abort = new AbortController();
    controller.current = abort;
    try {
      const response = await fetch('/api/v1/admin/api-pool/profiles/' + testId + '/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ question }),
        signal: abort.signal,
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.message || 'Không gửi được yêu cầu.');
      }
      if (!response.body) throw new Error('Không có phản hồi streaming.');
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = '',
        completed = false;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = block.match(/^event: (.+)$/m)?.[1],
            raw = block.match(/^data: (.+)$/m)?.[1];
          if (!raw) continue;
          const value = JSON.parse(raw);
          if (event === 'delta') setPartial((t) => t + value.text);
          if (event === 'result') {
            completed = true;
            setResult(value);
            setPartial('');
          }
          if (event === 'error') throw new Error(value.message);
        }
      }
      if (!completed) throw new Error('Kết nối bị ngắt trước khi có kết quả kiểm thử.');
      await refresh(true);
    } catch (e) {
      setPartial('');
      setError(
        (e as Error).name === 'AbortError'
          ? 'Đã dừng yêu cầu. Nhà cung cấp có thể vẫn tính phí phần đã xử lý.'
          : (e as Error).message,
      );
    } finally {
      setBusy('');
      controller.current = null;
    }
  }
  const isReady = (profile: ApiProfile) => profile.ready;
  function setupMessage(profile: ApiProfile) {
    if (!profile.enabled) return 'Cấu hình đang tắt. Bật cấu hình trong mục Sửa trước khi gửi thử.';
    if (!profile.model) return 'Chưa chọn model. Tải danh sách model rồi chọn model trong mục Sửa.';
    if (profile.auth === 'bearer' && !profile.hasKey)
      return 'Chưa lưu API key. Nhập key trong mục Sửa.';
    if (!profile.pricesConfirmed)
      return 'Chưa xác nhận giá token. Nhập giá input/output và tích ô xác nhận trong mục Sửa. Yêu cầu chưa được gửi đến nhà cung cấp.';
    if (data?.localOnly && profile.network !== 'local')
      return 'Máy chủ đang ở chế độ nội bộ; cấu hình API bên ngoài chưa được phép sử dụng.';
    return '';
  }
  const selectedProfile = data?.profiles.find((profile) => profile.id === testId);
  const pendingSetup = selectedProfile ? setupMessage(selectedProfile) : '';
  function toggleRoute(lane: 'simple' | 'complex', id: string) {
    setRouting((r) => ({
      ...r,
      [lane]: r[lane].includes(id) ? r[lane].filter((x) => x !== id) : [...r[lane], id],
    }));
  }
  if (!loading && identity?.role !== 'admin')
    return (
      <Shell title="Pool API & model">
        <div className="empty-state">
          <ShieldCheck size={36} />
          <h2>Kho API dành cho quản trị viên</h2>
          <p>Đăng nhập quản trị để quản lý kết nối và chạy thử model.</p>
          <Link href="/login" className="button primary">
            Đăng nhập
          </Link>
        </div>
      </Shell>
    );
  return (
    <Shell title="Pool API & model" eyebrow="KẾT NỐI DỊCH VỤ AI">
      <div className="page-content api-pool-page">
        <Link className="back-link" href="/admin">
          <ArrowLeft size={15} />
          Tổng quan quản trị
        </Link>
        <div className="page-intro pool-intro">
          <div>
            <span className="section-kicker">MỘT NƠI CHO CÁC KẾT NỐI CỦA BẠN</span>
            <h2>
              Chọn API. Thử model. Dùng thật<span className="heading-dot">.</span>
            </h2>
            <p>Lưu nhiều cấu hình, kiểm tra phản hồi và chọn model phục vụ hội thoại.</p>
          </div>
          <button
            className="button primary compact"
            disabled={loading || Boolean(busy)}
            onClick={() => openEditor()}
          >
            <Plus size={16} />
            Thêm cấu hình API
          </button>
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
        {!data ? (
          <div className="loading-state">Đang tải kho API…</div>
        ) : (
          <>
            <div className="pool-summary">
              <div>
                <Server size={19} />
                <span>
                  <b>{data.profiles.length}</b> cấu hình đã lưu
                </span>
              </div>
              <div>
                <CheckCircle2 size={19} />
                <span>
                  <b>{data.profiles.filter(isReady).length}</b> sẵn sàng phục vụ chat
                </span>
              </div>
              <div>
                <Wallet size={19} />
                <span>
                  Ngân sách tháng <b>${data.budgetUsd}</b>
                </span>
              </div>
              <div>
                <span className="live-dot" />
                <span>
                  Chat đang dùng:{' '}
                  <b>{data.routing.enabled ? 'Pool API' : data.environmentProvider}</b>
                </span>
              </div>
            </div>
            {data.localOnly && (
              <div className="alert">
                <Monitor size={18} />
                Máy chủ đang ở chế độ nội bộ. Chỉ các cấu hình mạng nội bộ được phép gửi yêu cầu.
              </div>
            )}
            {!data.profiles.length ? (
              <section className="pool-empty panel">
                <div className="empty-icon">
                  <Server size={33} />
                </div>
                <h3>Bắt đầu với API bạn muốn thử</h3>
                <p>
                  Chọn một mẫu kết nối, nhập base URL và key nếu dịch vụ yêu cầu.
                  <br />
                  Model ID có thể tải trực tiếp từ máy chủ sau khi lưu cấu hình.
                </p>
                <div className="preset-options">
                  {data.presets.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        openEditor();
                        setForm({
                          ...fresh(),
                          ...p.defaults,
                          preset: p.id,
                          name: p.name,
                          pricesConfirmed: p.defaults.network === 'local',
                        });
                      }}
                    >
                      {p.defaults.network === 'local' ? <Monitor size={17} /> : <Globe size={17} />}
                      <span>{p.name}</span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <div className="pool-profile-grid">
                {data.profiles.map((profile) => {
                  const metrics = data.metrics.find((m) => m.id === profile.id);
                  const pending = setupMessage(profile);
                  const active =
                    data.routing.enabled &&
                    isReady(profile) &&
                    (data.routing.simple.includes(profile.id) ||
                      data.routing.complex.includes(profile.id));
                  return (
                    <article
                      className={'pool-profile panel ' + (active ? 'selected-profile' : '')}
                      key={profile.id}
                    >
                      <div className="pool-profile-head">
                        <span className="document-icon">
                          {profile.network === 'local' ? (
                            <Monitor size={22} />
                          ) : (
                            <Globe size={22} />
                          )}
                        </span>
                        <div>
                          <h3>{profile.name}</h3>
                          <small>
                            {data.presets.find((p) => p.id === profile.preset)?.name} ·{' '}
                            {profile.network === 'local' ? 'Nội bộ' : 'Bên ngoài'}
                          </small>
                        </div>
                        <span
                          className={
                            'status-pill ' +
                            (pending
                              ? 'insufficient'
                              : isReady(profile)
                                ? 'passed'
                                : profile.lastTest?.ok === false
                                  ? 'failed'
                                  : 'insufficient')
                          }
                        >
                          {!profile.enabled
                            ? 'Đang tắt'
                            : pending
                              ? 'Cần hoàn thiện cấu hình'
                              : active
                                ? 'Đang phục vụ chat'
                                : isReady(profile)
                                  ? 'Sẵn sàng phục vụ chat'
                                  : profile.lastTest?.ok === false
                                    ? 'Chưa sẵn sàng'
                                    : 'Chưa gửi thử thành công'}
                        </span>
                      </div>
                      <div className="pool-endpoint">
                        <span>BASE URL</span>
                        <code>{profile.baseUrl}</code>
                      </div>
                      <div className="pool-model-line">
                        <Server size={14} />
                        <strong>{profile.model || 'Chưa chọn model'}</strong>
                        <span>
                          <KeyRound size={13} />
                          {profile.auth === 'none'
                            ? 'Không cần key'
                            : profile.hasKey
                              ? 'Đã lưu key'
                              : 'Chưa có key'}
                        </span>
                      </div>
                      <div className="pool-profile-metrics">
                        <div>
                          <b>{metrics?.calls || 0}</b>
                          <small>Lượt gọi tháng</small>
                        </div>
                        <div>
                          <b>{profile.lastTest ? profile.lastTest.latencyMs + ' ms' : '—'}</b>
                          <small>Lần thử gần nhất</small>
                        </div>
                        <div>
                          <b>{usd(metrics?.costUsd || 0)}</b>
                          <small>Chi phí ghi nhận</small>
                        </div>
                      </div>
                      {pending && <div className="alert">{pending}</div>}
                      {!pending && profile.lastTest && !profile.lastTest.ok && (
                        <div className="pool-inline-error">
                          Lần thử gần nhất · {profile.lastTest.errorCode}:{' '}
                          {profile.lastTest.message}
                        </div>
                      )}
                      {profile.cooldownUntil && (
                        <div className="pool-inline-error">
                          Tạm nghỉ đến {new Date(profile.cooldownUntil).toLocaleTimeString('vi-VN')}
                        </div>
                      )}
                      <div className="pool-profile-actions">
                        <button
                          className="button secondary compact"
                          disabled={Boolean(busy)}
                          onClick={() => void models(profile)}
                        >
                          {busy === 'models:' + profile.id ? (
                            <LoaderCircle size={14} className="spin" />
                          ) : (
                            <RefreshCw size={14} />
                          )}
                          Tải model
                        </button>
                        <button
                          className="button secondary compact"
                          disabled={Boolean(busy)}
                          onClick={() => {
                            setTestId(profile.id);
                            setResult(null);
                            document
                              .getElementById('pool-test')
                              ?.scrollIntoView({ behavior: 'smooth' });
                          }}
                        >
                          <Play size={13} />
                          Thử API
                        </button>
                        <button
                          className="icon-button"
                          disabled={Boolean(busy)}
                          aria-label={'Sửa ' + profile.name}
                          onClick={() => openEditor(profile)}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="icon-button"
                          disabled={Boolean(busy)}
                          aria-label={'Xóa ' + profile.name}
                          onClick={() => {
                            setError('');
                            setDeleting(profile);
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                      {modelLists[profile.id] && (
                        <p className="microcopy pool-model-count">
                          Đã nhận {modelLists[profile.id].length} model. Mở “Sửa” để chọn từ danh
                          sách.
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
            <div className="pool-workbench">
              <section className="panel" id="pool-test">
                <div className="panel-heading">
                  <div>
                    <h3>Gửi thử đến server</h3>
                    <p>Dùng căn cứ học vụ giả để xem phản hồi từ API đã chọn.</p>
                  </div>
                  <Play size={20} />
                </div>
                <div className="panel-padding">
                  <label className="pool-label" htmlFor="pool-test-profile">
                    Cấu hình cần thử
                  </label>
                  <select
                    id="pool-test-profile"
                    disabled={Boolean(busy)}
                    value={testId}
                    onChange={(e) => {
                      setTestId(e.target.value);
                      setResult(null);
                    }}
                  >
                    <option value="">Chọn cấu hình API</option>
                    {data.profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.model || 'chưa chọn model'}
                      </option>
                    ))}
                  </select>
                  {pendingSetup && selectedProfile && (
                    <div className="alert" role="status">
                      <p>{pendingSetup}</p>
                      <button
                        className="button secondary compact"
                        disabled={Boolean(busy)}
                        onClick={() => openEditor(selectedProfile)}
                      >
                        <Pencil size={14} />
                        Hoàn thiện cấu hình
                      </button>
                    </div>
                  )}
                  <label className="pool-label" htmlFor="pool-test-question">
                    Câu hỏi thử nghiệm
                  </label>
                  <textarea
                    id="pool-test-question"
                    rows={4}
                    value={question}
                    disabled={Boolean(busy)}
                    onChange={(e) => setQuestion(e.target.value)}
                    maxLength={2000}
                  />
                  <p className="microcopy">
                    Yêu cầu được gửi thật tới API và có thể tính phí theo nhà cung cấp. Căn cứ kèm
                    theo là dữ liệu giả: điểm 6,2, PI2.1 = F.
                  </p>
                  {busy === 'test' ? (
                    <button
                      className="button secondary full"
                      onClick={() => controller.current?.abort()}
                    >
                      <Square size={14} />
                      Dừng yêu cầu
                    </button>
                  ) : (
                    <button
                      className="button primary full"
                      disabled={
                        Boolean(busy) || !testId || !question.trim() || Boolean(pendingSetup)
                      }
                      onClick={() => void sendTest()}
                    >
                      <Play size={15} />
                      Gửi thử API
                    </button>
                  )}
                  {busy === 'test' && (
                    <div className="pool-stream">
                      <div className="thinking">
                        <LoaderCircle className="spin" size={16} />
                        {partial ? 'API đang trả lời…' : 'Đang kết nối API đã chọn…'}
                      </div>
                      <p>{partial}</p>
                    </div>
                  )}
                  {result && (
                    <div
                      className={'pool-test-result ' + (result.ok ? 'test-ok' : 'test-error')}
                      role="status"
                    >
                      <div className="pool-result-heading">
                        {result.ok ? <CheckCircle2 size={19} /> : <AlertCircle size={19} />}
                        <strong>
                          {result.ok ? 'Nhận được phản hồi từ API' : 'Yêu cầu chưa thành công'}
                        </strong>
                      </div>
                      <p>{result.message}</p>
                      <div className="pool-result-stats">
                        <span>
                          <Clock3 size={13} />
                          {result.latencyMs} ms
                        </span>
                        {result.firstTokenMs !== undefined && (
                          <span>Token đầu: {result.firstTokenMs} ms</span>
                        )}
                        <span>
                          {result.inputTokens ?? '—'} vào / {result.outputTokens ?? '—'} ra
                        </span>
                        {result.costUsd !== undefined && (
                          <span>
                            {result.usageEstimated ? 'Ước tính: ' : ''}
                            {usd(result.costUsd)}
                          </span>
                        )}
                      </div>
                      {result.errorCode && <code>{result.errorCode}</code>}
                      {result.reply && <div className="pool-reply">{result.reply}</div>}
                    </div>
                  )}
                </div>
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h3>Chọn API phục vụ chat</h3>
                    <p>Chỉ sử dụng cấu hình đã gửi thử thành công.</p>
                  </div>
                  <SlidersHorizontal size={21} />
                </div>
                <div className="panel-padding">
                  <label className="pool-toggle-row">
                    <span>
                      <b>Bật pool cho website và khung nhúng</b>
                      <small>Lưu lựa chọn để áp dụng cho các câu hỏi mới.</small>
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label="Bật pool phục vụ chat"
                      checked={routing.enabled}
                      disabled={Boolean(busy)}
                      onChange={(e) => setRouting((r) => ({ ...r, enabled: e.target.checked }))}
                    />
                  </label>
                  <label className="pool-label" htmlFor="pool-strategy">
                    Cách chọn API
                  </label>
                  <select
                    id="pool-strategy"
                    value={routing.strategy}
                    disabled={Boolean(busy)}
                    onChange={(e) =>
                      setRouting((r) => ({
                        ...r,
                        strategy: e.target.value as ApiPoolRouting['strategy'],
                        simple: r.simple.slice(0, 1),
                        complex: r.complex.slice(0, 1),
                      }))
                    }
                  >
                    <option value="manual">Chọn thủ công · một API mỗi tuyến</option>
                    <option value="round_robin">Phân phối lần lượt giữa các API</option>
                  </select>
                  {(['simple', 'complex'] as const).map((lane) => (
                    <div key={lane} className="pool-route">
                      <label className="pool-label" htmlFor={'route-' + lane}>
                        {lane === 'simple' ? 'Câu hỏi thông thường' : 'Câu hỏi tổng hợp'}
                      </label>
                      {routing.strategy === 'manual' ? (
                        <select
                          id={'route-' + lane}
                          value={routing[lane][0] || ''}
                          disabled={Boolean(busy)}
                          onChange={(e) =>
                            setRouting((r) => ({
                              ...r,
                              [lane]: e.target.value ? [e.target.value] : [],
                            }))
                          }
                        >
                          <option value="">Chọn API đã kiểm tra</option>
                          {data.profiles.map((p) => (
                            <option key={p.id} value={p.id} disabled={!isReady(p)}>
                              {p.name} · {p.model || 'chưa chọn model'}
                              {!isReady(p) ? ' · chưa sẵn sàng' : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="pool-route-options">
                          {data.profiles.map((p) => {
                            const selected = routing[lane].includes(p.id);
                            return (
                              <label key={p.id}>
                                <input
                                  type="checkbox"
                                  disabled={Boolean(busy) || (!isReady(p) && !selected)}
                                  checked={selected}
                                  onChange={() => toggleRoute(lane, p.id)}
                                />
                                <span>
                                  {p.name}
                                  <small>
                                    {p.model || 'Chưa chọn model'}
                                    {!isReady(p) ? ' · chưa sẵn sàng' : ''}
                                  </small>
                                </span>
                              </label>
                            );
                          })}
                          {!data.profiles.length && (
                            <p className="microcopy">Thêm cấu hình để chọn tuyến.</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  <p className="microcopy">
                    Mỗi yêu cầu gửi tới một API. Nếu API đó lỗi, chat báo lỗi và cho thử lại; không
                    gửi lại dữ liệu sang API khác. Pool tự động dùng cùng phạm vi nội bộ hoặc bên
                    ngoài.
                  </p>
                  <button
                    className="button primary full"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run(
                        'routing',
                        async () => {
                          await post('/admin/api-pool/routing', routing);
                          await refreshApp();
                        },
                        'Đã lưu lựa chọn API cho các cuộc trò chuyện mới.',
                      )
                    }
                  >
                    <CheckCircle2 size={16} />
                    Lưu lựa chọn cho chat
                  </button>
                </div>
              </section>
            </div>
            <div className="knowledge-footnote">
              <ShieldCheck size={18} />
              <p>
                API key chỉ lưu và sử dụng ở máy chủ. Chi phí dựa trên giá token bạn khai báo và
                usage do API trả về; khi usage không có, hệ thống giữ khoản dự phòng. Giới hạn mỗi
                lượt hiện tại: {usd(data.maxRequestCostUsd)}.
              </p>
            </div>
          </>
        )}
      </div>
      {editorOpen && (
        <div className="modal-backdrop">
          <div
            className="modal large pool-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pool-editor-title"
          >
            <button
              className="modal-close icon-button"
              aria-label="Đóng cấu hình API"
              disabled={busy === 'save'}
              onClick={() => {
                setEditorOpen(false);
                setKey('');
              }}
            >
              <X size={20} />
            </button>
            <h2 id="pool-editor-title">{editing ? 'Sửa cấu hình API' : 'Thêm cấu hình API'}</h2>
            {formError && (
              <div className="alert error" role="alert">
                {formError}
              </div>
            )}
            <form onSubmit={save}>
              <div className="form-grid">
                <label>
                  Mẫu nhà cung cấp
                  <select
                    aria-label="Mẫu nhà cung cấp"
                    value={form.preset}
                    disabled={Boolean(editing)}
                    onChange={(e) => {
                      const p = data!.presets.find((p) => p.id === e.target.value)!;
                      setForm({
                        ...fresh(),
                        ...p.defaults,
                        preset: p.id,
                        name: p.name,
                        pricesConfirmed: p.defaults.network === 'local',
                      });
                      setKey('');
                    }}
                  >
                    {data?.presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Tên cấu hình
                  <input
                    required
                    maxLength={100}
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </label>
              </div>
              <label>
                Base URL
                <input
                  required
                  type="url"
                  placeholder="https://api.example.com/v1"
                  value={form.baseUrl}
                  onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                />
              </label>
              <div className="form-grid">
                <label>
                  Phạm vi máy chủ
                  <select
                    value={form.network}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        network: e.target.value as ApiProfileConfig['network'],
                      }))
                    }
                  >
                    <option value="cloud">API bên ngoài · HTTPS</option>
                    <option value="local">Nội bộ / localhost</option>
                  </select>
                </label>
                <label>
                  Xác thực
                  <select
                    value={form.auth}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, auth: e.target.value as ApiProfileConfig['auth'] }))
                    }
                  >
                    <option value="bearer">Bearer API key</option>
                    <option value="none">Không cần key · nội bộ</option>
                  </select>
                </label>
              </div>
              {form.auth === 'bearer' && (
                <>
                  <label>
                    API key {editing?.hasKey ? '· đã lưu, để trống để giữ lại' : ''}
                    <input
                      type="password"
                      autoComplete="new-password"
                      spellCheck={false}
                      value={key}
                      disabled={clearKey}
                      onChange={(e) => setKey(e.target.value)}
                      placeholder={
                        editing?.hasKey ? 'Nhập key mới để thay thế' : 'Nhập API key của dịch vụ'
                      }
                    />
                  </label>
                  {editing?.hasKey && (
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={clearKey}
                        onChange={(e) => {
                          setClearKey(e.target.checked);
                          setKey('');
                        }}
                      />
                      Xóa key đã lưu
                    </label>
                  )}
                </>
              )}
              <label>
                Model ID
                <input
                  list="pool-model-options"
                  autoComplete="off"
                  value={form.model}
                  placeholder="Có thể chọn sau khi tải danh sách model"
                  onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                />
              </label>
              <datalist id="pool-model-options">
                {editing && modelLists[editing.id]?.map((m) => <option key={m.id} value={m.id} />)}
              </datalist>
              {editing && modelLists[editing.id]?.length ? (
                <label>
                  Chọn từ danh sách máy chủ
                  <select
                    aria-label="Model từ máy chủ"
                    value={form.model}
                    onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                  >
                    <option value="">Chọn model</option>
                    {modelLists[editing.id].map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="microcopy">
                  Lưu cấu hình trước, rồi bấm “Tải model”. Danh sách model phụ thuộc quyền tài khoản
                  và dịch vụ đang chạy.
                </p>
              )}
              <div className="form-grid">
                <label>
                  Giá input · USD / 1 triệu token
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    step="any"
                    required
                    value={form.inputUsdPerMillion}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        inputUsdPerMillion: Number(e.target.value),
                        pricesConfirmed: false,
                      }))
                    }
                  />
                </label>
                <label>
                  Giá output · USD / 1 triệu token
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    step="any"
                    required
                    value={form.outputUsdPerMillion}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        outputUsdPerMillion: Number(e.target.value),
                        pricesConfirmed: false,
                      }))
                    }
                  />
                </label>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.pricesConfirmed}
                  onChange={(e) => setForm((f) => ({ ...f, pricesConfirmed: e.target.checked }))}
                />
                Tôi đã kiểm tra giá của model này; nhập 0 nếu dịch vụ thực sự không tính phí API.
              </label>
              <div className="form-grid">
                <label>
                  Thời gian chờ · giây
                  <input
                    type="number"
                    min={1}
                    max={120}
                    required
                    value={form.timeoutMs / 1000}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, timeoutMs: Number(e.target.value) * 1000 }))
                    }
                  />
                </label>
                <label>
                  Giới hạn output token
                  <input
                    type="number"
                    min={16}
                    max={8192}
                    required
                    value={form.maxOutputTokens}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, maxOutputTokens: Number(e.target.value) }))
                    }
                  />
                </label>
              </div>
              <details className="pool-advanced">
                <summary>Tùy chọn tương thích & đồng thời</summary>
                <div className="form-grid">
                  <label>
                    Tham số giới hạn token
                    <select
                      value={form.tokenParameter}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          tokenParameter: e.target.value as ApiProfileConfig['tokenParameter'],
                        }))
                      }
                    >
                      <option value="max_completion_tokens">max_completion_tokens</option>
                      <option value="max_tokens">max_tokens</option>
                    </select>
                  </label>
                  <label>
                    Số yêu cầu đồng thời tối đa
                    <input
                      type="number"
                      required
                      min={1}
                      max={50}
                      value={form.maxConcurrent}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, maxConcurrent: Number(e.target.value) }))
                      }
                    />
                  </label>
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.includeUsage}
                    onChange={(e) => setForm((f) => ({ ...f, includeUsage: e.target.checked }))}
                  />
                  Gửi stream_options.include_usage
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.sendStore}
                    onChange={(e) => setForm((f) => ({ ...f, sendStore: e.target.checked }))}
                  />
                  Gửi store: false (khi API hỗ trợ)
                </label>
              </details>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                />
                Cho phép kiểm thử và lựa chọn cấu hình này
              </label>
              <div className="pool-editor-foot">
                <a
                  href={data?.presets.find((p) => p.id === form.preset)?.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ask-link"
                >
                  Tài liệu nhà cung cấp <ArrowUpRight size={14} />
                </a>
                <button className="button primary" disabled={Boolean(busy)}>
                  {busy === 'save' ? <LoaderCircle size={16} className="spin" /> : 'Lưu cấu hình'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {deleting && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pool-delete-title"
          >
            <h2 id="pool-delete-title">Xóa cấu hình {deleting.name}?</h2>
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            <p>
              API key đã lưu của cấu hình này cũng sẽ bị xóa. Số liệu sử dụng trước đó được giữ lại.
            </p>
            <div className="button-group">
              <button
                className="button secondary"
                disabled={Boolean(busy)}
                onClick={() => setDeleting(null)}
              >
                Giữ lại
              </button>
              <button
                className="button primary"
                disabled={Boolean(busy)}
                onClick={() =>
                  void run(
                    'delete',
                    async () => {
                      await api('/admin/api-pool/profiles/' + deleting.id, { method: 'DELETE' });
                      setDeleting(null);
                    },
                    'Đã xóa cấu hình API.',
                  )
                }
              >
                Xóa cấu hình
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
