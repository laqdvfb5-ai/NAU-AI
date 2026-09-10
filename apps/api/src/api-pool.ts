import OpenAI from 'openai';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type {
  ApiProfileConfig,
  ApiProfile,
  ApiTestResult,
  ApiPoolRouting,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  ApiProfileMetrics,
} from '@nau/domain';
import { Database } from './database.js';
import { Budget } from './providers.js';
import { env } from './config.js';
import { modelMessages } from './dialogue.js';
import { API_POOL_PRESETS } from './api-pool-presets.js';
import {
  createApiTransport,
  encryptApiKey,
  decryptApiKey,
  PoolError,
  publicPoolError,
  validateApiBaseUrl,
} from './api-pool-security.js';

export const apiProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    preset: z.enum(['openai', 'gemini', 'openrouter', 'ollama', 'vllm', 'compatible']),
    baseUrl: z.string().trim().min(8).max(500),
    model: z
      .string()
      .trim()
      .max(200)
      .regex(/^[\w./:@+\-]*$/),
    network: z.enum(['cloud', 'local']),
    auth: z.enum(['bearer', 'none']),
    enabled: z.boolean(),
    timeoutMs: z.number().int().min(1000).max(120000),
    maxOutputTokens: z.number().int().min(16).max(8192),
    maxConcurrent: z.number().int().min(1).max(50),
    inputUsdPerMillion: z.number().min(0).max(1000),
    outputUsdPerMillion: z.number().min(0).max(1000),
    pricesConfirmed: z.boolean(),
    tokenParameter: z.enum(['max_completion_tokens', 'max_tokens']),
    includeUsage: z.boolean(),
    sendStore: z.boolean(),
  })
  .strict();
export const apiProfileInputSchema = apiProfileSchema
  .extend({
    apiKey: z
      .string()
      .trim()
      .min(1)
      .max(8192)
      .regex(/^[\x21-\x7E]+$/)
      .optional(),
    clearKey: z.boolean().optional(),
    revision: z.number().int().positive().optional(),
  })
  .strict();
export const poolRoutingSchema = z
  .object({
    enabled: z.boolean(),
    strategy: z.enum(['manual', 'round_robin']),
    simple: z.array(z.uuid()).max(20),
    complex: z.array(z.uuid()).max(20),
  })
  .strict();
type ProfileRow = {
  id: string;
  config: ApiProfileConfig;
  encrypted_key: string | null;
  revision: number;
  last_test: ApiTestResult | null;
  last_success_revision: number | null;
  created_at: Date | string;
  updated_at: Date | string;
};
type Runtime = { inFlight: number; failures: number; cooldownUntil: number };
const DEFAULT_ROUTING: ApiPoolRouting = {
  enabled: false,
  strategy: 'manual',
  simple: [],
  complex: [],
};

export class ApiPoolService {
  private readonly logger = new Logger(ApiPoolService.name);
  private runtime = new Map<string, Runtime>();
  private routing: ApiPoolRouting = { ...DEFAULT_ROUTING };
  constructor(
    private db: Database,
    private budget: Budget,
  ) {}
  get currentRouting() {
    return this.routing;
  }
  private state(id: string) {
    let state = this.runtime.get(id);
    if (!state) {
      state = { inFlight: 0, failures: 0, cooldownUntil: 0 };
      this.runtime.set(id, state);
    }
    return state;
  }
  async refresh() {
    const [r] = await this.db.query<{ value: ApiPoolRouting }>(
      'SELECT value FROM settings WHERE key=$1',
      ['api_pool_routing'],
    );
    this.routing = r ? poolRoutingSchema.parse(r.value) : { ...DEFAULT_ROUTING };
  }
  private async row(id: string) {
    const [row] = await this.db.query<ProfileRow>('SELECT * FROM api_profiles WHERE id=$1', [id]);
    if (!row) throw new PoolError('NOT_FOUND', 'Không tìm thấy cấu hình API.');
    return row;
  }
  private publicProfile(row: ProfileRow): ApiProfile {
    const runtime = this.state(row.id);
    return {
      ...row.config,
      id: row.id,
      hasKey: Boolean(row.encrypted_key),
      revision: row.revision,
      ready: row.last_success_revision === row.revision,
      lastTest: row.last_test,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      inFlight: runtime.inFlight,
      cooldownUntil:
        runtime.cooldownUntil > Date.now() ? new Date(runtime.cooldownUntil).toISOString() : null,
    };
  }
  async list() {
    return (
      await this.db.query<ProfileRow>('SELECT * FROM api_profiles ORDER BY created_at,id')
    ).map((r) => this.publicProfile(r));
  }
  async overview() {
    await this.refresh();
    return {
      profiles: await this.list(),
      routing: this.routing,
      presets: API_POOL_PRESETS,
      localOnly: env.llm === 'local',
      environmentProvider: env.llm,
      metrics: await this.metrics(),
      budgetUsd: env.budget,
      maxRequestCostUsd: env.maxCost,
    };
  }
  async metrics(): Promise<ApiProfileMetrics[]> {
    const rows = await this.db.query(
      "SELECT provider_id AS id,count(*) AS calls,count(*) FILTER (WHERE status LIKE 'pool_error_%') AS errors,coalesce(sum(cost_usd),0) AS cost_usd,coalesce(sum(input_tokens),0) AS input_tokens,coalesce(sum(output_tokens),0) AS output_tokens,coalesce(avg(latency_ms),0) AS latency_ms FROM usage WHERE provider_id IS NOT NULL AND created_at>=date_trunc('month',now()) GROUP BY provider_id",
    );
    return rows.map((r) => ({
      id: r.id,
      calls: Number(r.calls),
      errors: Number(r.errors),
      costUsd: Number(r.cost_usd),
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      averageLatencyMs: Math.round(Number(r.latency_ms)),
    }));
  }
  async save(input: unknown, actor: string, id?: string) {
    const { apiKey, clearKey, revision, ...config } = apiProfileInputSchema.parse(input);
    config.baseUrl = validateApiBaseUrl(config.baseUrl, config.network).href.replace(/\/$/, '');
    if (config.network === 'cloud' && config.auth === 'none')
      throw new PoolError('KEY_REQUIRED', 'API bên ngoài cần xác thực Bearer.');
    if (apiKey && clearKey)
      throw new PoolError(
        'INVALID_KEY_CHANGE',
        'Chọn nhập key mới hoặc xóa key, không chọn đồng thời.',
      );
    const profileId = id || randomUUID(),
      previous = id ? await this.row(id) : null;
    if (previous && revision !== previous.revision)
      throw new PoolError(
        'STALE_PROFILE',
        'Cấu hình đã thay đổi ở phiên khác. Làm mới trước khi lưu.',
      );
    if (previous && this.state(profileId).inFlight)
      throw new PoolError('BUSY', 'API đang xử lý yêu cầu; chờ hoàn tất trước khi sửa.');
    if (
      previous &&
      previous.encrypted_key &&
      new URL(previous.config.baseUrl).origin !== new URL(config.baseUrl).origin &&
      !apiKey &&
      !clearKey
    )
      throw new PoolError(
        'REENTER_KEY',
        'Khi đổi máy chủ, nhập lại hoặc xóa API key để tránh gửi nhầm key sang nơi khác.',
      );
    const encrypted =
      clearKey || config.auth === 'none'
        ? null
        : apiKey
          ? encryptApiKey(apiKey, profileId)
          : previous?.encrypted_key || null;
    if (previous) {
      const updated = await this.db.query(
        'UPDATE api_profiles SET config=$2,encrypted_key=$3,revision=revision+1,last_test=NULL,updated_at=now() WHERE id=$1 AND revision=$4 RETURNING id',
        [profileId, JSON.stringify(config), encrypted, revision],
      );
      if (!updated.length)
        throw new PoolError('STALE_PROFILE', 'Cấu hình đã thay đổi. Hãy tải lại.');
    } else {
      const [{ count }] = await this.db.query('SELECT count(*) FROM api_profiles');
      if (Number(count) >= 100)
        throw new PoolError('POOL_LIMIT', 'Kho hỗ trợ tối đa 100 cấu hình.');
      await this.db.query('INSERT INTO api_profiles(id,config,encrypted_key) VALUES($1,$2,$3)', [
        profileId,
        JSON.stringify(config),
        encrypted,
      ]);
    }
    this.runtime.delete(profileId);
    await this.db.audit(actor, previous ? 'api_profile_updated' : 'api_profile_created', {
      profileId,
      name: config.name,
    });
    return this.publicProfile(await this.row(profileId));
  }
  async remove(id: string, actor: string) {
    await this.refresh();
    await this.row(id);
    if (this.routing.simple.includes(id) || this.routing.complex.includes(id))
      throw new PoolError('IN_USE', 'Bỏ cấu hình khỏi các tuyến chat trước khi xóa.');
    if (this.state(id).inFlight) throw new PoolError('BUSY', 'API đang xử lý yêu cầu.');
    await this.db.query('DELETE FROM api_profiles WHERE id=$1', [id]);
    this.runtime.delete(id);
    await this.db.audit(actor, 'api_profile_deleted', { profileId: id });
    return { ok: true };
  }
  private checkUsable(row: ProfileRow, requireTest = false) {
    if (!row.config.model)
      throw new PoolError('MODEL_REQUIRED', 'Chọn model ID trước khi gửi thử hoặc dùng cho chat.');
    if (env.llm === 'local' && row.config.network !== 'local')
      throw new PoolError(
        'LOCAL_ONLY',
        'Máy chủ đang ở chế độ nội bộ; không thể gọi API bên ngoài.',
      );
    if (!row.config.enabled) throw new PoolError('DISABLED', 'Cấu hình API đang tắt.');
    if (row.config.auth === 'bearer' && !row.encrypted_key)
      throw new PoolError('KEY_REQUIRED', 'Cấu hình chưa có API key.');
    if (!row.config.pricesConfirmed)
      throw new PoolError(
        'PRICES_REQUIRED',
        'Xác nhận giá token của model trước khi gửi yêu cầu có thể tính phí.',
      );
    if (requireTest && row.last_success_revision !== row.revision)
      throw new PoolError(
        'TEST_REQUIRED',
        `Cấu hình “${row.config.name}” cần gửi thử thành công sau lần sửa gần nhất.`,
      );
  }
  async setRouting(input: unknown, actor: string) {
    const config = poolRoutingSchema.parse(input);
    if (
      new Set(config.simple).size !== config.simple.length ||
      new Set(config.complex).size !== config.complex.length
    )
      throw new PoolError('DUPLICATE_ROUTE', 'Một API chỉ được xuất hiện một lần trong mỗi tuyến.');
    if (config.enabled) {
      if (!config.simple.length || !config.complex.length)
        throw new PoolError(
          'EMPTY_ROUTE',
          'Chọn API cho cả câu hỏi thông thường và câu hỏi tổng hợp.',
        );
      if (
        config.strategy === 'manual' &&
        (config.simple.length !== 1 || config.complex.length !== 1)
      )
        throw new PoolError('INVALID_ROUTE', 'Chế độ thủ công dùng một API cho mỗi tuyến.');
    }
    const rows: ProfileRow[] = [];
    for (const id of new Set([...config.simple, ...config.complex])) {
      const row = await this.row(id);
      if (config.enabled) this.checkUsable(row, true);
      rows.push(row);
    }
    if (config.strategy === 'round_robin' && new Set(rows.map((r) => r.config.network)).size > 1)
      throw new PoolError(
        'MIXED_NETWORK',
        'Pool phân phối tự động phải cùng phạm vi nội bộ hoặc bên ngoài.',
      );
    await this.db.query(
      'INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      ['api_pool_routing', JSON.stringify(config)],
    );
    this.routing = config;
    await this.db.audit(actor, 'api_pool_routing_updated', { ...config });
    return config;
  }
  private client(row: ProfileRow) {
    const key = row.encrypted_key ? decryptApiKey(row.encrypted_key, row.id) : 'local-no-key';
    const transport = createApiTransport(row.config.baseUrl, row.config.network);
    const fetcher: typeof globalThis.fetch = (input, init) => {
      if (row.config.auth === 'none') {
        const headers = new Headers(init?.headers);
        headers.delete('Authorization');
        return transport.fetch(input, { ...init, headers });
      }
      return transport.fetch(input, init);
    };
    const client = new OpenAI({
      apiKey: key,
      baseURL: row.config.baseUrl,
      maxRetries: 0,
      timeout: row.config.timeoutMs,
      fetch: fetcher,
    });
    return { client, close: transport.close };
  }
  async models(id: string, actor: string) {
    const row = await this.row(id);
    if (env.llm === 'local' && row.config.network !== 'local')
      throw new PoolError('LOCAL_ONLY', 'Máy chủ đang ở chế độ nội bộ.');
    if (row.config.auth === 'bearer' && !row.encrypted_key)
      throw new PoolError('KEY_REQUIRED', 'Lưu API key trước khi tải danh sách model.');
    const started = performance.now(),
      connection = this.client(row);
    try {
      const page = await connection.client.models.list();
      const models = page.data
        .filter((m) => typeof m.id === 'string')
        .slice(0, 1000)
        .map((m) => ({ id: m.id, ownedBy: m.owned_by || '' }));
      await this.db.audit(actor, 'api_models_listed', { profileId: id, count: models.length });
      return {
        models,
        latencyMs: Math.round(performance.now() - started),
        message: 'Danh sách do máy chủ trả về. Cần gửi thử để xác nhận model hỗ trợ chat.',
      };
    } catch (error) {
      const safe = publicPoolError(error);
      throw new PoolError(safe.code, safe.message);
    } finally {
      await connection.close();
    }
  }
  private acquire(row: ProfileRow) {
    const state = this.state(row.id);
    if (state.cooldownUntil > Date.now())
      throw new PoolError(
        'COOLDOWN',
        'API đang tạm nghỉ sau nhiều lỗi. Chờ 30 giây hoặc gửi thử để kiểm tra lại.',
      );
    if (state.inFlight >= row.config.maxConcurrent)
      throw new PoolError('BUSY', 'API đã đủ số yêu cầu đồng thời. Thử lại sau.');
    state.inFlight++;
    return state;
  }
  async invoke(
    row: ProfileRow,
    request: LLMRequest,
    purpose: 'chat' | 'test',
  ): Promise<LLMResponse & { latencyMs: number; firstTokenMs?: number }> {
    this.checkUsable(row, purpose === 'chat');
    if (purpose === 'test') this.state(row.id).cooldownUntil = 0;
    const state = this.acquire(row),
      started = performance.now();
    let firstTokenMs: number | undefined,
      connection: ReturnType<ApiPoolService['client']> | undefined,
      reservation: Awaited<ReturnType<Budget['reserve']>> | undefined,
      settled = false;
    const config = row.config;
    const signal = request.signal
      ? AbortSignal.any([request.signal, AbortSignal.timeout(config.timeoutMs)])
      : AbortSignal.timeout(config.timeoutMs);
    const messages = modelMessages(request);
    // UTF-8 byte count is deliberately conservative; all model calls reserve their configured output ceiling.
    const upper =
      (Buffer.byteLength(JSON.stringify(messages)) * config.inputUsdPerMillion +
        config.maxOutputTokens * config.outputUsdPerMillion) /
      1e6;
    try {
      signal.throwIfAborted();
      connection = this.client(row);
      try {
        reservation = await this.budget.reserve(config.model, upper, {
          providerId: row.id,
          purpose,
        });
      } catch {
        throw new PoolError(
          'BUDGET_LIMIT',
          'Ngân sách tháng hoặc giới hạn mỗi lượt không đủ cho cấu hình này. Kiểm tra giá token và giới hạn đầu ra.',
        );
      }
      const response = await connection.client.chat.completions.create(
        {
          model: config.model,
          messages,
          stream: true,
          ...(config.sendStore ? { store: false } : {}),
          ...(config.includeUsage ? { stream_options: { include_usage: true } } : {}),
          [config.tokenParameter]: config.maxOutputTokens,
        },
        { signal },
      );
      let text = '',
        usage: { prompt_tokens: number; completion_tokens: number } | null = null;
      for await (const chunk of response) {
        const delta = chunk.choices[0]?.delta?.content;
        if (typeof delta === 'string' && delta) {
          if (firstTokenMs === undefined) firstTokenMs = Math.round(performance.now() - started);
          text += delta;
          if (text.length > 100000)
            throw new PoolError('RESPONSE_TOO_LARGE', 'API trả văn bản vượt giới hạn.');
          request.onText?.(delta);
        }
        if (chunk.usage) usage = chunk.usage;
      }
      signal.throwIfAborted();
      if (!text.trim())
        throw new PoolError(
          'EMPTY_RESPONSE',
          'API chưa trả văn bản. Kiểm tra model hoặc tăng giới hạn output cho model reasoning.',
        );
      const validUsage =
        usage &&
        Number.isFinite(usage.prompt_tokens) &&
        Number.isFinite(usage.completion_tokens) &&
        usage.prompt_tokens >= 0 &&
        usage.completion_tokens >= 0;
      const input = validUsage ? usage!.prompt_tokens : 0,
        output = validUsage ? usage!.completion_tokens : 0,
        cost = validUsage
          ? (input * config.inputUsdPerMillion + output * config.outputUsdPerMillion) / 1e6
          : upper;
      await this.budget.finish(
        reservation,
        input,
        output,
        cost,
        validUsage ? 'completed' : 'usage_unknown',
      );
      settled = true;
      state.failures = 0;
      state.cooldownUntil = 0;
      const latencyMs = Math.round(performance.now() - started);
      await this.db.query('UPDATE usage SET latency_ms=$2 WHERE id=$1', [
        reservation.id,
        latencyMs,
      ]);
      return {
        text,
        model: config.model,
        providerId: row.id,
        providerName: config.name,
        mode: 'pool',
        inputTokens: input,
        outputTokens: output,
        costUsd: cost,
        usageEstimated: !validUsage,
        latencyMs,
        firstTokenMs,
      };
    } catch (error) {
      const safe = publicPoolError(error);
      if (!['BUDGET_LIMIT', 'TIMEOUT', 'KEY_STORAGE'].includes(safe.code)) {
        state.failures++;
        if (state.failures >= 3) state.cooldownUntil = Date.now() + 30000;
      }
      if (purpose === 'chat')
        this.logger.warn(
          JSON.stringify({
            event: 'api_pool_request_failed',
            providerId: row.id,
            revision: row.revision,
            purpose,
            code: safe.code,
            failures: state.failures,
            latencyMs: Math.round(performance.now() - started),
            ...(reservation ? { usageId: reservation.id } : {}),
          }),
        );
      if (reservation && !settled) {
        await this.budget.finish(reservation, 0, 0, reservation.amount, 'pool_error_' + safe.code);
        await this.db.query('UPDATE usage SET latency_ms=$2 WHERE id=$1', [
          reservation.id,
          Math.round(performance.now() - started),
        ]);
      }
      throw new PoolError(safe.code, safe.message);
    } finally {
      state.inFlight--;
      await connection?.close();
    }
  }
  async test(
    id: string,
    question: string,
    actor: string,
    signal?: AbortSignal,
    onText?: (text: string) => void,
  ) {
    const row = await this.row(id),
      started = performance.now();
    let result: ApiTestResult;
    try {
      const response = await this.invoke(
        row,
        {
          question,
          evidence:
            'DỮ LIỆU GIẢ dùng kiểm tra kết nối: học phần cốt lõi có điểm tổng 6,2/10, PI2.1 là F (3/10), bài bắt buộc đã hoàn thành. Bộ đối chiếu xác định chưa đạt điều kiện PI theo quy chế 620/2025 Điều 12 khoản 4. Không có hồ sơ sinh viên thật trong yêu cầu này.',
          complex: false,
          signal,
          onText,
        },
        'test',
      );
      result = {
        ok: true,
        kind: 'completion',
        checkedAt: new Date().toISOString(),
        revision: row.revision,
        model: row.config.model,
        latencyMs: response.latencyMs,
        firstTokenMs: response.firstTokenMs,
        message:
          'API đã trả văn bản. Đây là kiểm tra kết nối, chưa phải chứng nhận chất lượng học vụ.',
        reply: response.text,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        costUsd: response.costUsd,
        usageEstimated: response.usageEstimated,
      };
    } catch (error) {
      const safe = publicPoolError(error);
      result = {
        ok: false,
        kind: 'completion',
        checkedAt: new Date().toISOString(),
        revision: row.revision,
        model: row.config.model,
        latencyMs: Math.round(performance.now() - started),
        message: safe.message,
        errorCode: safe.code,
      };
    }
    const { reply, ...stored } = result;
    await this.db.query(
      'UPDATE api_profiles SET last_test=$2,last_success_revision=CASE WHEN $4 THEN revision ELSE last_success_revision END WHERE id=$1 AND revision=$3',
      [id, JSON.stringify(stored), row.revision, result.ok],
    );
    await this.db.audit(actor, 'api_profile_tested', {
      profileId: id,
      ok: result.ok,
      errorCode: result.errorCode || null,
    });
    return result;
  }
  async generate(request: LLMRequest) {
    await this.refresh();
    if (!this.routing.enabled) throw new PoolError('POOL_DISABLED', 'Pool API đang tắt.');
    const lane = request.complex ? 'complex' : 'simple',
      ids = this.routing[lane];
    if (!ids.length) throw new PoolError('EMPTY_ROUTE', 'Chưa chọn API cho loại câu hỏi này.');
    let ordered = ids;
    if (this.routing.strategy === 'round_robin') {
      const key = 'api_pool_cursor:' + lane;
      await this.db.query("INSERT INTO settings(key,value) VALUES($1,'0') ON CONFLICT DO NOTHING", [
        key,
      ]);
      const [cursor] = await this.db.query(
        'UPDATE settings SET value=to_jsonb(((value::text)::bigint+1)%1000000000) WHERE key=$1 RETURNING value',
        [key],
      );
      const start = (Number(cursor.value) - 1 + ids.length) % ids.length;
      ordered = [...ids.slice(start), ...ids.slice(0, start)];
    }
    let chosen: ProfileRow | undefined;
    let lastError: unknown;
    for (const id of ordered) {
      try {
        const row = await this.row(id);
        this.checkUsable(row, true);
        const state = this.state(id);
        if (state.inFlight >= row.config.maxConcurrent || state.cooldownUntil > Date.now())
          throw new PoolError('BUSY', 'API đang bận hoặc tạm nghỉ.');
        chosen = row;
        break;
      } catch (error) {
        lastError = error;
        if (this.routing.strategy === 'manual') throw error;
      }
    }
    if (!chosen) throw lastError || new PoolError('NO_API_AVAILABLE', 'Chưa có API sẵn sàng.');
    // Exactly one provider receives each request. An upstream failure does not resend private evidence elsewhere.
    return this.invoke(chosen, request, 'chat');
  }
}
export class PooledLLM implements LLMProvider {
  constructor(
    private pool: ApiPoolService,
    private fallback: LLMProvider,
  ) {}
  get mode() {
    return this.pool.currentRouting.enabled ? 'pool' : this.fallback.mode;
  }
  async refresh() {
    await this.pool.refresh();
  }
  async generate(request: LLMRequest) {
    if (this.pool.currentRouting.enabled) return this.pool.generate(request);
    return this.fallback.generate(request);
  }
}
