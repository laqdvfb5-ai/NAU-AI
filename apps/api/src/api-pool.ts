import OpenAI from 'openai';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type {
  ApiProfileConfig,
  ApiProfile,
  ApiTestResult,
  ApiPoolRouting,
  ApiPoolReadiness,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  ApiProfileMetrics,
  ApiGatewayPolicy,
  ApiGatewayScore,
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
import {
  DEFAULT_GATEWAY_POLICY,
  gatewayPolicySchema,
  isAdaptiveRetryable,
  normalizeProfileConfig,
  parseGatewayPolicy,
  scoreCandidates,
  type GatewayProviderState,
} from './adaptive-gateway.js';

export { DEFAULT_GATEWAY_POLICY, scoreCandidates } from './adaptive-gateway.js';

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
    qualityScore: z.number().finite().min(0).max(100).default(70),
    allowPersonalData: z.boolean().default(false),
    trustGroup: z
      .string()
      .trim()
      .max(100)
      .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i)
      .optional(),
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
type GatewayStateRow = {
  provider_id: string;
  revision: number;
  success_count: number | string;
  failure_count: number | string;
  consecutive_failures: number | string;
  latency_ewma_ms: number | string | null;
  first_token_ewma_ms: number | string | null;
  quality_ewma: number | string | null;
  circuit_state: string;
  circuit_open_until: Date | string | null;
  last_error_code: string | null;
  last_attempt_at: Date | string | null;
  last_success_at: Date | string | null;
  next_probe_at: Date | string | null;
  probe_claim_until: Date | string | null;
};
type Candidate = {
  row: ProfileRow;
  state: GatewayStateRow;
  activeLeases: number;
  expectedCostUsd: number;
  score: ApiGatewayScore;
  halfOpen: boolean;
  gateCode?: string;
};
type AttemptContext = {
  requestId: string;
  attemptNo: number;
  lane: 'simple' | 'complex';
  score: ApiGatewayScore | null;
  scoreSnapshot: ApiGatewayScore[];
  deadlineAt: number;
};
const DEFAULT_ROUTING: ApiPoolRouting = {
  enabled: false,
  strategy: 'manual',
  simple: [],
  complex: [],
};

const READINESS_INVALIDATING_ERRORS = new Set([
  'AUTH_FAILED',
  'DISABLED',
  'INCOMPATIBLE_REQUEST',
  'KEY_REQUIRED',
  'KEY_STORAGE',
  'LOCAL_ONLY',
  'MODEL_REQUIRED',
  'NETWORK_BLOCKED',
  'NOT_FOUND',
  'PRICES_REQUIRED',
]);

const CIRCUIT_COUNTED_ERRORS = new Set([
  'CONNECTION_FAILED',
  'EMPTY_RESPONSE',
  'RATE_LIMIT',
  'TIMEOUT',
  'UPSTREAM_ERROR',
]);

class PoolAttemptError extends PoolError {
  constructor(
    code: string,
    message: string,
    readonly committed: boolean,
    readonly latencyMs: number,
    readonly firstTokenMs: number | undefined,
    readonly callerAborted: boolean,
  ) {
    super(code, message);
    this.name = 'PoolAttemptError';
  }
}

function invalidatesReadiness(code: string) {
  return READINESS_INVALIDATING_ERRORS.has(code);
}

export class ApiPoolService {
  private readonly logger = new Logger(ApiPoolService.name);
  private routing: ApiPoolRouting = { ...DEFAULT_ROUTING };
  private policy: ApiGatewayPolicy = structuredClone(DEFAULT_GATEWAY_POLICY);
  private probeTimer?: NodeJS.Timeout;
  constructor(
    private db: Database,
    private budget: Budget,
  ) {}
  get currentRouting() {
    return this.routing;
  }
  get currentPolicy() {
    return this.policy;
  }
  async refresh() {
    const settings = await this.db.query<{ key: string; value: unknown }>(
      'SELECT key,value FROM settings WHERE key IN ($1,$2)',
      ['api_pool_routing', 'api_gateway_policy_v1'],
    );
    const routing = settings.find((entry) => entry.key === 'api_pool_routing');
    const policy = settings.find((entry) => entry.key === 'api_gateway_policy_v1');
    this.routing = routing ? poolRoutingSchema.parse(routing.value) : { ...DEFAULT_ROUTING };
    this.policy = policy
      ? parseGatewayPolicy(policy.value)
      : structuredClone(DEFAULT_GATEWAY_POLICY);
  }
  private async row(id: string) {
    const [row] = await this.db.query<ProfileRow>('SELECT * FROM api_profiles WHERE id=$1', [id]);
    if (!row) throw new PoolError('NOT_FOUND', 'Không tìm thấy cấu hình API.');
    return row;
  }
  private publicProfile(row: ProfileRow, state?: GatewayStateRow, inFlight = 0): ApiProfile {
    const config = normalizeProfileConfig(row.config, `profile-${row.id}`);
    const openUntil = state?.circuit_open_until ? new Date(state.circuit_open_until).getTime() : 0;
    return {
      ...config,
      id: row.id,
      hasKey: Boolean(row.encrypted_key),
      revision: row.revision,
      ready: row.last_success_revision === row.revision,
      lastTest: row.last_test,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      inFlight,
      cooldownUntil: openUntil > Date.now() ? new Date(openUntil).toISOString() : null,
    };
  }
  async list() {
    const rows = await this.db.query<ProfileRow>(
      'SELECT * FROM api_profiles ORDER BY created_at,id',
    );
    const states = await this.db.query<GatewayStateRow>(
      'SELECT * FROM provider_gateway_state WHERE (provider_id,revision) IN (SELECT id,revision FROM api_profiles)',
    );
    const leases = await this.db.query<{ provider_id: string; revision: number; count: string }>(
      'SELECT provider_id,revision,count(*) AS count FROM provider_gateway_leases WHERE expires_at>now() GROUP BY provider_id,revision',
    );
    return rows.map((row) =>
      this.publicProfile(
        row,
        states.find((state) => state.provider_id === row.id && state.revision === row.revision),
        Number(
          leases.find((lease) => lease.provider_id === row.id && lease.revision === row.revision)
            ?.count || 0,
        ),
      ),
    );
  }
  async overview() {
    await this.refresh();
    const [recentAttempts, states] = await Promise.all([
      this.db.query(
        'SELECT id,request_id,attempt_no,lane,purpose,provider_id,provider_revision,model,status,error_code,retryable,committed,selection_score,selection_reason,latency_ms,first_token_ms,input_tokens,output_tokens,cost_usd,created_at,completed_at FROM gateway_attempts ORDER BY created_at DESC LIMIT 100',
      ),
      this.db.query(
        'SELECT provider_id,revision,success_count,failure_count,consecutive_failures,success_ewma,latency_ewma_ms,first_token_ewma_ms,cost_ewma_usd,quality_ewma,circuit_state,circuit_open_until,last_error_code,last_attempt_at,last_success_at,next_probe_at FROM provider_gateway_state ORDER BY updated_at DESC',
      ),
    ]);
    const laneSnapshot = async (lane: 'simple' | 'complex') => {
      if (!this.routing[lane].length) return { candidates: [] };
      try {
        const candidates = await this.candidates(this.routing[lane], {
          question: 'Ước tính định tuyến',
          evidence: '',
          complex: lane === 'complex',
          sensitivity: 'public',
        });
        return {
          candidates: candidates.map((candidate) => ({
            providerId: candidate.row.id,
            score: candidate.score.score,
            components: candidate.score.components,
            eligible: candidate.score.eligible,
            reason: candidate.score.reason,
            expectedCostUsd: candidate.expectedCostUsd,
            activeLeases: candidate.activeLeases,
            maxConcurrent: normalizeProfileConfig(
              candidate.row.config,
              `profile-${candidate.row.id}`,
            ).maxConcurrent,
            circuitState: candidate.state.circuit_state,
            successCount: Number(candidate.state.success_count),
            failureCount: Number(candidate.state.failure_count),
            ewmaLatencyMs:
              candidate.state.latency_ewma_ms === null
                ? null
                : Number(candidate.state.latency_ewma_ms),
            ewmaFirstTokenMs:
              candidate.state.first_token_ewma_ms === null
                ? null
                : Number(candidate.state.first_token_ewma_ms),
          })),
        };
      } catch (error) {
        this.logger.warn(
          JSON.stringify({
            event: 'api_gateway_telemetry_snapshot_failed',
            lane,
            error: error instanceof Error ? error.name : 'unknown',
          }),
        );
        return { candidates: [] };
      }
    };
    const laneTelemetry = {
      simple: await laneSnapshot('simple'),
      complex: await laneSnapshot('complex'),
    };
    return {
      profiles: await this.list(),
      routing: this.routing,
      policy: this.policy,
      supportedGatewayModes: ['off', 'shadow', 'active'] as const,
      gatewayTelemetry: { providerStates: states, recentAttempts, lanes: laneTelemetry },
      presets: API_POOL_PRESETS,
      localOnly: env.llm === 'local',
      environmentProvider: env.llm,
      metrics: await this.metrics(),
      budgetUsd: env.budget,
      maxRequestCostUsd: env.maxCost,
    };
  }
  async readiness(): Promise<ApiPoolReadiness> {
    await this.refresh();
    if (!this.routing.enabled)
      return {
        enabled: false,
        ready: false,
        lanes: { simple: false, complex: false },
      };

    const rows = await this.db.query<ProfileRow>('SELECT * FROM api_profiles');
    const states = await this.db.query<GatewayStateRow>(
      'SELECT * FROM provider_gateway_state WHERE (provider_id,revision) IN (SELECT id,revision FROM api_profiles)',
    );
    const leases = await this.db.query<{ provider_id: string; revision: number; count: string }>(
      'SELECT provider_id,revision,count(*) AS count FROM provider_gateway_leases WHERE expires_at>now() GROUP BY provider_id,revision',
    );
    const readyIds = new Set(
      rows
        .filter((row) => {
          try {
            this.checkUsable(row, true);
            const state = states.find(
              (candidate) =>
                candidate.provider_id === row.id && candidate.revision === row.revision,
            );
            const openUntil = state?.circuit_open_until
              ? new Date(state.circuit_open_until).getTime()
              : 0;
            const active = Number(
              leases.find(
                (lease) => lease.provider_id === row.id && lease.revision === row.revision,
              )?.count || 0,
            );
            return (
              openUntil <= Date.now() &&
              active < normalizeProfileConfig(row.config, `profile-${row.id}`).maxConcurrent
            );
          } catch {
            return false;
          }
        })
        .map((row) => row.id),
    );
    const lanes = {
      simple: this.routing.simple.some((id) => readyIds.has(id)),
      complex: this.routing.complex.some((id) => readyIds.has(id)),
    };
    return {
      enabled: true,
      ready: lanes.simple && lanes.complex,
      lanes,
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

  private async gatewayState(row: ProfileRow): Promise<GatewayStateRow> {
    await this.db.query(
      'INSERT INTO provider_gateway_state(provider_id,revision) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [row.id, row.revision],
    );
    const [state] = await this.db.query<GatewayStateRow>(
      'SELECT * FROM provider_gateway_state WHERE provider_id=$1 AND revision=$2',
      [row.id, row.revision],
    );
    return state;
  }

  private expectedCost(row: ProfileRow, request: LLMRequest) {
    const config = normalizeProfileConfig(row.config, `profile-${row.id}`);
    const messages = modelMessages(request);
    return (
      (Buffer.byteLength(JSON.stringify(messages)) * config.inputUsdPerMillion +
        config.maxOutputTokens * config.outputUsdPerMillion) /
      1e6
    );
  }
  async save(input: unknown, actor: string, id?: string) {
    const { apiKey, clearKey, revision, ...parsedConfig } = apiProfileInputSchema.parse(input);
    const profileId = id || randomUUID();
    const config = normalizeProfileConfig({
      ...parsedConfig,
      trustGroup: parsedConfig.trustGroup || `profile-${profileId}`,
    });
    config.baseUrl = validateApiBaseUrl(config.baseUrl, config.network).href.replace(/\/$/, '');
    if (config.network === 'cloud' && config.auth === 'none')
      throw new PoolError('KEY_REQUIRED', 'API bên ngoài cần xác thực Bearer.');
    if (apiKey && clearKey)
      throw new PoolError(
        'INVALID_KEY_CHANGE',
        'Chọn nhập key mới hoặc xóa key, không chọn đồng thời.',
      );
    if (id) {
      await this.db.transaction(async (query) => {
        const [previous] = await query<ProfileRow>(
          'SELECT * FROM api_profiles WHERE id=$1 FOR UPDATE',
          [profileId],
        );
        if (!previous) throw new PoolError('NOT_FOUND', 'Không tìm thấy cấu hình API.');
        if (revision !== previous.revision)
          throw new PoolError(
            'STALE_PROFILE',
            'Cấu hình đã thay đổi ở phiên khác. Làm mới trước khi lưu.',
          );
        const [{ count }] = await query<{ count: string }>(
          'SELECT count(*) AS count FROM provider_gateway_leases WHERE provider_id=$1 AND revision=$2 AND expires_at>now()',
          [profileId, previous.revision],
        );
        if (Number(count))
          throw new PoolError('BUSY', 'API đang xử lý yêu cầu; chờ hoàn tất trước khi sửa.');
        if (
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
              : previous.encrypted_key;
        const updated = await query(
          `UPDATE api_profiles
           SET config=$2,encrypted_key=$3,revision=revision+1,last_test=NULL,updated_at=now()
           WHERE id=$1 AND revision=$4
           RETURNING id`,
          [profileId, JSON.stringify(config), encrypted, revision],
        );
        if (!updated.length)
          throw new PoolError('STALE_PROFILE', 'Cấu hình đã thay đổi. Hãy tải lại.');
      });
    } else {
      const [{ count }] = await this.db.query('SELECT count(*) FROM api_profiles');
      if (Number(count) >= 100)
        throw new PoolError('POOL_LIMIT', 'Kho hỗ trợ tối đa 100 cấu hình.');
      const encrypted =
        clearKey || config.auth === 'none'
          ? null
          : apiKey
            ? encryptApiKey(apiKey, profileId)
            : null;
      await this.db.query('INSERT INTO api_profiles(id,config,encrypted_key) VALUES($1,$2,$3)', [
        profileId,
        JSON.stringify(config),
        encrypted,
      ]);
    }
    await this.db.audit(actor, id ? 'api_profile_updated' : 'api_profile_created', {
      profileId,
      name: config.name,
    });
    return this.publicProfile(await this.row(profileId));
  }
  async remove(id: string, actor: string) {
    await this.refresh();
    if (this.routing.simple.includes(id) || this.routing.complex.includes(id))
      throw new PoolError('IN_USE', 'Bỏ cấu hình khỏi các tuyến chat trước khi xóa.');
    await this.db.transaction(async (query) => {
      const [profile] = await query<{ id: string }>(
        'SELECT id FROM api_profiles WHERE id=$1 FOR UPDATE',
        [id],
      );
      if (!profile) throw new PoolError('NOT_FOUND', 'Không tìm thấy cấu hình API.');
      const [{ count }] = await query<{ count: string }>(
        'SELECT count(*) AS count FROM provider_gateway_leases WHERE provider_id=$1 AND expires_at>now()',
        [id],
      );
      if (Number(count))
        throw new PoolError('BUSY', 'API đang xử lý yêu cầu; chờ hoàn tất trước khi xóa.');
      await query('DELETE FROM api_profiles WHERE id=$1', [id]);
    });
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
  private async validateConfiguration(routingInput: unknown, policyInput: unknown) {
    const routing = poolRoutingSchema.parse(routingInput);
    const policy = gatewayPolicySchema.parse(policyInput);
    if (
      new Set(routing.simple).size !== routing.simple.length ||
      new Set(routing.complex).size !== routing.complex.length
    )
      throw new PoolError('DUPLICATE_ROUTE', 'Một API chỉ được xuất hiện một lần trong mỗi tuyến.');
    if (routing.enabled) {
      if (!routing.simple.length || !routing.complex.length)
        throw new PoolError(
          'EMPTY_ROUTE',
          'Chọn API cho cả câu hỏi thông thường và câu hỏi tổng hợp.',
        );
      if (
        policy.mode === 'off' &&
        routing.strategy === 'manual' &&
        (routing.simple.length !== 1 || routing.complex.length !== 1)
      )
        throw new PoolError('INVALID_ROUTE', 'Chế độ thủ công dùng một API cho mỗi tuyến.');
    }

    const rows = new Map<string, ProfileRow>();
    for (const id of new Set([...routing.simple, ...routing.complex])) {
      const profile = await this.row(id);
      if (routing.enabled) this.checkUsable(profile, true);
      rows.set(id, profile);
    }
    if (
      routing.strategy === 'round_robin' &&
      new Set([...rows.values()].map((row) => row.config.network)).size > 1
    )
      throw new PoolError(
        'MIXED_NETWORK',
        'Pool phân phối tự động phải cùng phạm vi nội bộ hoặc bên ngoài.',
      );
    if (policy.mode !== 'off') {
      for (const lane of ['simple', 'complex'] as const) {
        const networks = new Set(routing[lane].map((id) => rows.get(id)!.config.network));
        if (networks.size > 1)
          throw new PoolError(
            'MIXED_NETWORK',
            'Các ứng viên adaptive trong cùng một tuyến phải cùng phạm vi mạng.',
          );
      }
    }
    return { routing, policy };
  }

  async setConfiguration(input: unknown, actor: string) {
    const parsed = z.object({ routing: z.unknown(), policy: z.unknown() }).strict().parse(input);
    const { routing, policy } = await this.validateConfiguration(parsed.routing, parsed.policy);
    await this.db.query(
      'INSERT INTO settings(key,value) VALUES($1,$2),($3,$4) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      [
        'api_pool_routing',
        JSON.stringify(routing),
        'api_gateway_policy_v1',
        JSON.stringify(policy),
      ],
    );
    this.routing = routing;
    this.policy = policy;
    await this.db.audit(actor, 'api_gateway_configuration_updated', { routing, policy });
    return { routing, policy };
  }

  async setRouting(input: unknown, actor: string) {
    await this.refresh();
    const result = await this.setConfiguration({ routing: input, policy: this.policy }, actor);
    return result.routing;
  }

  async setPolicy(input: unknown, actor: string) {
    await this.refresh();
    const result = await this.setConfiguration({ routing: this.routing, policy: input }, actor);
    return result.policy;
  }
  private client(row: ProfileRow) {
    const config = normalizeProfileConfig(row.config, `profile-${row.id}`);
    const key = row.encrypted_key ? decryptApiKey(row.encrypted_key, row.id) : 'local-no-key';
    const transport = createApiTransport(config.baseUrl, config.network);
    const fetcher: typeof globalThis.fetch = (input, init) => {
      if (config.auth === 'none') {
        const headers = new Headers(init?.headers);
        headers.delete('Authorization');
        return transport.fetch(input, { ...init, headers });
      }
      return transport.fetch(input, init);
    };
    const client = new OpenAI({
      apiKey: key,
      baseURL: config.baseUrl,
      maxRetries: 0,
      timeout: config.timeoutMs,
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
  private stateView(state: GatewayStateRow): GatewayProviderState {
    return {
      successCount: Number(state.success_count),
      failureCount: Number(state.failure_count),
      consecutiveFailures: Number(state.consecutive_failures),
      ewmaLatencyMs: state.latency_ewma_ms === null ? null : Number(state.latency_ewma_ms),
      ewmaFirstTokenMs:
        state.first_token_ewma_ms === null ? null : Number(state.first_token_ewma_ms),
      openUntil: state.circuit_open_until,
    };
  }

  private async recordGatewaySuccess(
    row: ProfileRow,
    latencyMs: number,
    firstTokenMs: number | undefined,
    costUsd: number,
    purpose: 'chat' | 'test' | 'probe',
  ) {
    if (purpose !== 'chat') {
      await this.db.query(
        `UPDATE provider_gateway_state
         SET consecutive_failures=0,circuit_state='closed',circuit_open_until=NULL,
             last_error_code=NULL,last_attempt_at=now(),last_success_at=now(),updated_at=now()
         WHERE provider_id=$1 AND revision=$2`,
        [row.id, row.revision],
      );
      return;
    }
    await this.db.query(
      `UPDATE provider_gateway_state
       SET success_count=success_count+1,
           consecutive_failures=0,
           success_ewma=success_ewma*0.8+0.2,
           latency_ewma_ms=CASE WHEN latency_ewma_ms IS NULL THEN $3::double precision ELSE latency_ewma_ms*0.8+($3::double precision)*0.2 END,
           first_token_ewma_ms=CASE WHEN $4::double precision IS NULL THEN first_token_ewma_ms WHEN first_token_ewma_ms IS NULL THEN $4::double precision ELSE first_token_ewma_ms*0.8+($4::double precision)*0.2 END,
           cost_ewma_usd=CASE WHEN cost_ewma_usd IS NULL THEN $5::double precision ELSE cost_ewma_usd*0.8+($5::double precision)*0.2 END,
           circuit_state='closed',circuit_open_until=NULL,last_error_code=NULL,
           last_attempt_at=now(),last_success_at=now(),updated_at=now()
       WHERE provider_id=$1 AND revision=$2`,
      [row.id, row.revision, latencyMs, firstTokenMs ?? null, costUsd],
    );
  }

  private async recordGatewayFailure(
    row: ProfileRow,
    code: string,
    callerAborted: boolean,
    purpose: 'chat' | 'test' | 'probe',
  ) {
    if (purpose !== 'chat') {
      await this.db.query(
        'UPDATE provider_gateway_state SET last_error_code=$3,last_attempt_at=now(),updated_at=now() WHERE provider_id=$1 AND revision=$2',
        [row.id, row.revision, code],
      );
      return;
    }
    const counted = CIRCUIT_COUNTED_ERRORS.has(code) && !callerAborted;
    if (!counted) {
      await this.db.query(
        'UPDATE provider_gateway_state SET last_error_code=$3,last_attempt_at=now(),updated_at=now() WHERE provider_id=$1 AND revision=$2',
        [row.id, row.revision, code],
      );
      return;
    }
    await this.db.query(
      `UPDATE provider_gateway_state
       SET failure_count=failure_count+1,
           consecutive_failures=consecutive_failures+1,
           success_ewma=success_ewma*0.8,
           circuit_state=CASE WHEN consecutive_failures+1 >= $4 THEN 'open' ELSE circuit_state END,
           circuit_open_until=CASE WHEN consecutive_failures+1 >= $4 THEN now()+($5 * interval '1 second') ELSE circuit_open_until END,
           last_error_code=$3,last_attempt_at=now(),updated_at=now()
       WHERE provider_id=$1 AND revision=$2`,
      [row.id, row.revision, code, this.policy.failureThreshold, this.policy.cooldownSeconds],
    );
  }

  private async updateAttempt(
    attemptId: string,
    values: {
      status: 'completed' | 'failed';
      errorCode?: string;
      retryable?: boolean;
      committed: boolean;
      latencyMs: number;
      firstTokenMs?: number;
      inputTokens?: number;
      outputTokens?: number;
      costUsd?: number;
    },
  ) {
    await this.db.query(
      `UPDATE gateway_attempts
       SET status=$2,error_code=$3,retryable=$4,committed=$5,latency_ms=$6,
           first_token_ms=$7,input_tokens=$8,output_tokens=$9,cost_usd=$10,completed_at=now()
       WHERE id=$1`,
      [
        attemptId,
        values.status,
        values.errorCode || null,
        values.retryable ?? null,
        values.committed,
        values.latencyMs,
        values.firstTokenMs ?? null,
        values.inputTokens || 0,
        values.outputTokens || 0,
        values.costUsd || 0,
      ],
    );
  }

  async recordFeedback(messageId: string) {
    const [winner] = await this.db.query<{
      provider_id: string;
      provider_revision: number;
      quality_prior: number | string;
    }>(
      `SELECT attempt.provider_id,attempt.provider_revision,
              coalesce((profile.config->>'qualityScore')::double precision,70) AS quality_prior
       FROM gateway_attempts attempt
       JOIN api_profiles profile ON profile.id=attempt.provider_id
       WHERE attempt.request_id=$1 AND attempt.status='completed'
       ORDER BY attempt.attempt_no DESC
       LIMIT 1`,
      [messageId],
    );
    if (!winner) return { learned: false };
    const [summary] = await this.db.query<{ total: string; positive: string }>(
      `SELECT count(*) AS total,count(*) FILTER (WHERE feedback.rating=1) AS positive
       FROM feedback
       JOIN gateway_attempts ON gateway_attempts.request_id=feedback.message_id
         AND gateway_attempts.status='completed'
       WHERE gateway_attempts.provider_id=$1 AND gateway_attempts.provider_revision=$2`,
      [winner.provider_id, winner.provider_revision],
    );
    const total = Number(summary?.total || 0);
    if (!total) return { learned: false };
    // Six pseudo-observations keep the operator prior relevant while feedback remains sparse.
    const qualityPrior = Math.min(1, Math.max(0, Number(winner.quality_prior) / 100));
    const posterior = (Number(summary.positive) + 1 + qualityPrior * 4) / (total + 6);
    await this.db.query(
      'UPDATE provider_gateway_state SET quality_ewma=$3,updated_at=now() WHERE provider_id=$1 AND revision=$2',
      [winner.provider_id, winner.provider_revision, posterior],
    );
    return { learned: true };
  }

  async invoke(
    row: ProfileRow,
    request: LLMRequest,
    purpose: 'chat' | 'test' | 'probe',
    attempt?: AttemptContext,
  ): Promise<LLMResponse & { latencyMs: number; firstTokenMs?: number }> {
    this.checkUsable(row, purpose === 'chat');
    const config = normalizeProfileConfig(row.config, `profile-${row.id}`),
      started = performance.now(),
      requestId = attempt?.requestId || request.requestId || randomUUID(),
      attemptNo = attempt?.attemptNo || 1,
      lane = attempt?.lane || (request.complex ? 'complex' : 'simple'),
      deadlineAt = attempt?.deadlineAt || Date.now() + config.timeoutMs,
      attemptId = randomUUID();
    let firstTokenMs: number | undefined,
      connection: ReturnType<ApiPoolService['client']> | undefined,
      reservation: Awaited<ReturnType<Budget['reserve']>> | undefined,
      lease: Awaited<ReturnType<Database['acquireProviderGatewayLease']>> | undefined,
      settled = false,
      committed = false;
    const messages = modelMessages(request);
    const upper = this.expectedCost(row, request);
    await this.db.query(
      `INSERT INTO gateway_attempts(
         id,request_id,attempt_no,lane,purpose,provider_id,provider_revision,model,
         sensitivity,selection_score,selection_reason
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        attemptId,
        requestId,
        attemptNo,
        lane,
        purpose,
        row.id,
        row.revision,
        config.model,
        request.sensitivity || 'public',
        attempt?.score?.score ?? null,
        JSON.stringify({
          mode: purpose === 'chat' ? this.policy.mode : purpose,
          selected: attempt?.score || null,
          candidates: attempt?.scoreSnapshot || [],
        }),
      ],
    );
    try {
      const gatewayState = await this.gatewayState(row);
      const openUntil = gatewayState.circuit_open_until
        ? new Date(gatewayState.circuit_open_until).getTime()
        : 0;
      const halfOpen =
        purpose === 'chat' && gatewayState.circuit_state !== 'closed' && openUntil <= Date.now();
      if (purpose === 'chat' && openUntil > Date.now())
        throw new PoolError(
          'COOLDOWN',
          'API đang tạm nghỉ sau nhiều lỗi. Chờ hết thời gian circuit rồi thử lại.',
        );
      if (halfOpen) {
        await this.db.query(
          "UPDATE provider_gateway_state SET circuit_state='half_open',updated_at=now() WHERE provider_id=$1 AND revision=$2 AND circuit_open_until<=now()",
          [row.id, row.revision],
        );
      }
      const remainingMs = Math.min(config.timeoutMs, deadlineAt - Date.now());
      if (remainingMs <= 0)
        throw new PoolError('TIMEOUT', 'Yêu cầu đã hết tổng thời gian chờ của gateway.');
      lease = await this.db.acquireProviderGatewayLease({
        providerId: row.id,
        revision: row.revision,
        maxConcurrent: halfOpen ? 1 : config.maxConcurrent,
        requestId: `${requestId}:${attemptNo}:${attemptId}`,
        ttlMs: Math.min(3_600_000, Math.ceil(remainingMs + 5_000)),
      });
      if (!lease) {
        const [current] = await this.db.query<{ revision: number }>(
          'SELECT revision FROM api_profiles WHERE id=$1',
          [row.id],
        );
        if (!current || current.revision !== row.revision)
          throw new PoolError(
            'STALE_PROFILE',
            'Cấu hình API vừa thay đổi; yêu cầu không dùng phiên bản cũ.',
          );
        const [currentState] = await this.db.query<GatewayStateRow>(
          'SELECT * FROM provider_gateway_state WHERE provider_id=$1 AND revision=$2',
          [row.id, row.revision],
        );
        const currentOpenUntil = currentState?.circuit_open_until
          ? new Date(currentState.circuit_open_until).getTime()
          : 0;
        if (currentState?.circuit_state === 'open' && currentOpenUntil > Date.now())
          throw new PoolError('COOLDOWN', 'API đang tạm nghỉ sau nhiều lỗi. Thử lại sau.');
        throw new PoolError('BUSY', 'API đã đủ số yêu cầu đồng thời. Thử lại sau.');
      }
      const [leasedRevision] = await this.db.query<{ revision: number }>(
        'SELECT revision FROM api_profiles WHERE id=$1',
        [row.id],
      );
      if (!leasedRevision || leasedRevision.revision !== row.revision) {
        await this.db.releaseProviderGatewayLease(lease);
        lease = undefined;
        throw new PoolError(
          'STALE_PROFILE',
          'Cấu hình API vừa thay đổi; yêu cầu không dùng phiên bản cũ.',
        );
      }
      const timeoutSignal = AbortSignal.timeout(Math.max(1, Math.ceil(remainingMs)));
      const signal = request.signal
        ? AbortSignal.any([request.signal, timeoutSignal])
        : timeoutSignal;
      signal.throwIfAborted();
      try {
        reservation = await this.budget.reserve(config.model, upper, {
          providerId: row.id,
          purpose,
          requestId,
          attemptNo,
          lane,
        });
      } catch {
        throw new PoolError(
          'BUDGET_LIMIT',
          'Ngân sách tháng hoặc giới hạn mỗi lượt không đủ cho cấu hình này. Kiểm tra giá token và giới hạn đầu ra.',
        );
      }
      connection = this.client(row);
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
          committed = true;
          if (firstTokenMs === undefined) firstTokenMs = Math.round(performance.now() - started);
          text += delta;
          if (text.length > 100000)
            throw new PoolError('RESPONSE_TOO_LARGE', 'API trả văn bản vượt giới hạn.');
          try {
            request.onText?.(delta);
          } catch {
            throw new PoolError(
              'CALLBACK_FAILED',
              'Không thể chuyển tiếp phản hồi model tới máy khách.',
            );
          }
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
          : upper,
        latencyMs = Math.round(performance.now() - started);
      try {
        await this.budget.finish(
          reservation,
          input,
          output,
          cost,
          validUsage ? 'completed' : 'usage_unknown',
          { latencyMs, firstTokenMs },
        );
      } catch (accountingError) {
        this.logger.error(
          JSON.stringify({
            event: 'api_gateway_accounting_finish_failed',
            providerId: row.id,
            revision: row.revision,
            usageId: reservation.id,
            error: accountingError instanceof Error ? accountingError.name : 'unknown',
          }),
        );
      }
      settled = true;
      try {
        await this.recordGatewaySuccess(row, latencyMs, firstTokenMs, cost, purpose);
        await this.updateAttempt(attemptId, {
          status: 'completed',
          committed,
          latencyMs,
          firstTokenMs,
          inputTokens: input,
          outputTokens: output,
          costUsd: cost,
        });
      } catch (telemetryError) {
        this.logger.error(
          JSON.stringify({
            event: 'api_gateway_success_telemetry_failed',
            providerId: row.id,
            revision: row.revision,
            error: telemetryError instanceof Error ? telemetryError.name : 'unknown',
          }),
        );
      }
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
      const safe = publicPoolError(error),
        callerAborted = Boolean(request.signal?.aborted),
        latencyMs = Math.round(performance.now() - started),
        retryable = !callerAborted && isAdaptiveRetryable(safe.code);
      try {
        await this.recordGatewayFailure(row, safe.code, callerAborted, purpose);
      } catch (stateError) {
        this.logger.error(
          JSON.stringify({
            event: 'api_gateway_state_update_failed',
            providerId: row.id,
            revision: row.revision,
            error: stateError instanceof Error ? stateError.name : 'unknown',
          }),
        );
      }
      if ((purpose === 'chat' || purpose === 'probe') && invalidatesReadiness(safe.code)) {
        try {
          await this.db.query(
            'UPDATE api_profiles SET last_success_revision=NULL WHERE id=$1 AND revision=$2',
            [row.id, row.revision],
          );
        } catch {
          this.logger.error(
            JSON.stringify({
              event: 'api_pool_readiness_invalidation_failed',
              providerId: row.id,
              revision: row.revision,
              code: safe.code,
            }),
          );
        }
      }
      if (purpose === 'chat')
        this.logger.warn(
          JSON.stringify({
            event: 'api_pool_request_failed',
            providerId: row.id,
            revision: row.revision,
            purpose,
            code: safe.code,
            committed,
            latencyMs,
            ...(reservation ? { usageId: reservation.id } : {}),
          }),
        );
      if (reservation && !settled) {
        try {
          await this.budget.finish(
            reservation,
            0,
            0,
            reservation.amount,
            'pool_error_' + safe.code,
            {
              latencyMs,
              firstTokenMs,
              errorCode: safe.code,
            },
          );
        } catch (accountingError) {
          this.logger.error(
            JSON.stringify({
              event: 'api_gateway_error_accounting_failed',
              providerId: row.id,
              revision: row.revision,
              usageId: reservation.id,
              error: accountingError instanceof Error ? accountingError.name : 'unknown',
            }),
          );
        }
      }
      try {
        await this.updateAttempt(attemptId, {
          status: 'failed',
          errorCode: safe.code,
          retryable,
          committed,
          latencyMs,
          firstTokenMs,
          costUsd: reservation && !settled ? reservation.amount : 0,
        });
      } catch (telemetryError) {
        this.logger.error(
          JSON.stringify({
            event: 'api_gateway_failure_telemetry_failed',
            providerId: row.id,
            revision: row.revision,
            error: telemetryError instanceof Error ? telemetryError.name : 'unknown',
          }),
        );
      }
      throw new PoolAttemptError(
        safe.code,
        safe.message,
        committed,
        latencyMs,
        firstTokenMs,
        callerAborted,
      );
    } finally {
      if (lease) {
        try {
          await this.db.releaseProviderGatewayLease(lease);
        } catch {
          this.logger.error(
            JSON.stringify({
              event: 'api_gateway_lease_release_failed',
              providerId: row.id,
              revision: row.revision,
            }),
          );
        }
      }
      try {
        await connection?.close();
      } catch {
        // The request is settled; closing a socket must not change its result.
      }
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
    const invalidate = !result.ok && invalidatesReadiness(result.errorCode || '');
    await this.db.query(
      'UPDATE api_profiles SET last_test=$2,last_success_revision=CASE WHEN $4 THEN revision WHEN $5 THEN NULL ELSE last_success_revision END WHERE id=$1 AND revision=$3',
      [id, JSON.stringify(stored), row.revision, result.ok, invalidate],
    );
    await this.db.audit(actor, 'api_profile_tested', {
      profileId: id,
      ok: result.ok,
      errorCode: result.errorCode || null,
    });
    return result;
  }
  private async candidates(ids: string[], request: LLMRequest): Promise<Candidate[]> {
    const uniqueIds = [...new Set(ids)];
    const [rows, leases] = await Promise.all([
      this.db.query<ProfileRow>('SELECT * FROM api_profiles WHERE id=ANY($1::text[])', [uniqueIds]),
      this.db.query<{ provider_id: string; revision: number; count: string }>(
        'SELECT provider_id,revision,count(*) AS count FROM provider_gateway_leases WHERE provider_id=ANY($1::text[]) AND expires_at>now() GROUP BY provider_id,revision',
        [uniqueIds],
      ),
    ]);
    const rowById = new Map(rows.map((row) => [row.id, row]));
    for (const id of uniqueIds)
      if (!rowById.has(id)) throw new PoolError('NOT_FOUND', 'Không tìm thấy cấu hình API.');
    await this.db.query(
      `INSERT INTO provider_gateway_state(provider_id,revision)
       SELECT id,revision FROM api_profiles WHERE id=ANY($1::text[])
       ON CONFLICT DO NOTHING`,
      [uniqueIds],
    );
    const states = await this.db.query<GatewayStateRow>(
      'SELECT * FROM provider_gateway_state WHERE provider_id=ANY($1::text[]) AND (provider_id,revision) IN (SELECT id,revision FROM api_profiles)',
      [uniqueIds],
    );
    const stateByProvider = new Map(states.map((state) => [state.provider_id, state]));
    const prepared: Array<{
      row: ProfileRow;
      state: GatewayStateRow;
      activeLeases: number;
      expectedCostUsd: number;
      halfOpen: boolean;
      gateCode?: string;
    }> = [];
    for (const id of ids) {
      const row = rowById.get(id)!,
        config = normalizeProfileConfig(row.config, `profile-${row.id}`),
        state = stateByProvider.get(row.id)!,
        activeLeases = Number(
          leases.find(
            (lease) => lease.provider_id === row.id && Number(lease.revision) === row.revision,
          )?.count || 0,
        ),
        expectedCostUsd = this.expectedCost(row, request),
        openUntil = state.circuit_open_until ? new Date(state.circuit_open_until).getTime() : 0,
        circuitOpen =
          state.circuit_state === 'open' && (!state.circuit_open_until || openUntil > Date.now()),
        halfOpen =
          state.circuit_state === 'half_open' ||
          (state.circuit_state === 'open' &&
            Boolean(state.circuit_open_until) &&
            openUntil <= Date.now());
      let gateCode: string | undefined;
      try {
        this.checkUsable(row, true);
      } catch (error) {
        gateCode = publicPoolError(error).code;
      }
      if (!gateCode && request.sensitivity === 'personal' && !config.allowPersonalData)
        gateCode = 'PERSONAL_DATA_BLOCKED';
      if (!gateCode && circuitOpen) gateCode = 'COOLDOWN';
      if (!gateCode && activeLeases >= (halfOpen ? 1 : config.maxConcurrent)) gateCode = 'BUSY';
      if (!gateCode && expectedCostUsd > env.maxCost) gateCode = 'BUDGET_LIMIT';
      prepared.push({ row, state, activeLeases, expectedCostUsd, halfOpen, gateCode });
    }
    const scores = scoreCandidates(
      prepared.map((candidate) => ({
        providerId: candidate.row.id,
        eligible: !candidate.gateCode,
        state: this.stateView(candidate.state),
        expectedCostUsd: candidate.expectedCostUsd,
        activeLeases: candidate.activeLeases,
        maxConcurrent: normalizeProfileConfig(candidate.row.config, `profile-${candidate.row.id}`)
          .maxConcurrent,
        qualityScore:
          candidate.state.quality_ewma === null
            ? normalizeProfileConfig(candidate.row.config, `profile-${candidate.row.id}`)
                .qualityScore
            : Number(candidate.state.quality_ewma) * 100,
      })),
      this.policy.weights,
    );
    return prepared.map((candidate, index) => ({
      ...candidate,
      score: {
        ...scores[index],
        eligible: !candidate.gateCode,
        ...(candidate.gateCode ? { reason: candidate.gateCode } : {}),
      },
    }));
  }

  private candidateError(candidate?: Candidate) {
    const code = candidate?.gateCode || 'NO_API_AVAILABLE';
    const messages: Record<string, string> = {
      AUTH_FAILED: 'API từ chối xác thực. Kiểm tra key và quyền truy cập model.',
      BUDGET_LIMIT: 'Giới hạn chi phí không đủ cho tuyến API đã chọn.',
      BUSY: 'API đã đủ số yêu cầu đồng thời. Thử lại sau.',
      COOLDOWN: 'API đang tạm nghỉ sau nhiều lỗi. Thử lại sau.',
      DISABLED: 'Cấu hình API đang tắt.',
      KEY_REQUIRED: 'Cấu hình chưa có API key.',
      PERSONAL_DATA_BLOCKED: 'Tuyến này chưa có API được phép xử lý dữ liệu sinh viên.',
      TEST_REQUIRED: 'Cấu hình API cần được gửi thử thành công sau lần sửa gần nhất.',
    };
    return new PoolError(
      code,
      messages[code] || 'Chưa có API phù hợp và sẵn sàng cho yêu cầu này.',
    );
  }

  private async legacyOrder(lane: 'simple' | 'complex') {
    const ids = this.routing[lane];
    if (this.routing.strategy !== 'round_robin') return [...ids];
    const key = 'api_pool_cursor:' + lane;
    await this.db.query("INSERT INTO settings(key,value) VALUES($1,'0') ON CONFLICT DO NOTHING", [
      key,
    ]);
    const [cursor] = await this.db.query(
      'UPDATE settings SET value=to_jsonb(((value::text)::bigint+1)%1000000000) WHERE key=$1 RETURNING value',
      [key],
    );
    const start = (Number(cursor.value) - 1 + ids.length) % ids.length;
    return [...ids.slice(start), ...ids.slice(0, start)];
  }

  private explorationIndex(requestId: string, candidateCount: number) {
    if (candidateCount < 2 || this.policy.explorationRate <= 0) return 0;
    const digest = createHash('sha256').update(requestId).digest();
    if (digest[0] / 256 >= this.policy.explorationRate) return 0;
    return 1 + (digest[1] % (candidateCount - 1));
  }

  async generate(request: LLMRequest) {
    await this.refresh();
    if (!this.routing.enabled) throw new PoolError('POOL_DISABLED', 'Pool API đang tắt.');
    const lane = request.complex ? 'complex' : 'simple',
      ids = this.routing[lane];
    if (!ids.length) throw new PoolError('EMPTY_ROUTE', 'Chưa chọn API cho loại câu hỏi này.');
    const requestId = request.requestId || randomUUID(),
      adaptiveDeadlineAt = Date.now() + this.policy.totalDeadlineMs,
      candidates = await this.candidates(ids, request),
      scoreSnapshot = candidates.map((candidate) => candidate.score);

    if (this.policy.mode !== 'active') {
      const orderedIds = await this.legacyOrder(lane);
      let selected: Candidate | undefined;
      if (this.routing.strategy === 'manual') {
        selected = candidates.find((candidate) => candidate.row.id === orderedIds[0]);
        if (!selected?.score.eligible) throw this.candidateError(selected);
      } else {
        selected = orderedIds
          .map((id) => candidates.find((candidate) => candidate.row.id === id))
          .find((candidate) => candidate?.score.eligible);
        if (!selected)
          throw this.candidateError(
            orderedIds
              .map((id) => candidates.find((candidate) => candidate.row.id === id))
              .find(Boolean),
          );
      }
      return this.invoke(selected.row, { ...request, requestId }, 'chat', {
        requestId,
        attemptNo: 1,
        lane,
        score: this.policy.mode === 'shadow' ? selected.score : null,
        scoreSnapshot: this.policy.mode === 'shadow' ? scoreSnapshot : [],
        deadlineAt:
          Date.now() +
          normalizeProfileConfig(selected.row.config, `profile-${selected.row.id}`).timeoutMs,
      });
    }

    const ranked = candidates
      .filter((candidate) => candidate.score.eligible)
      .sort(
        (a, b) => b.score.score - a.score.score || ids.indexOf(a.row.id) - ids.indexOf(b.row.id),
      );
    if (!ranked.length)
      throw this.candidateError(candidates.find((candidate) => candidate.gateCode));
    const exploreAt = this.explorationIndex(requestId, ranked.length);
    if (exploreAt > 0) ranked.unshift(ranked.splice(exploreAt, 1)[0]);

    let lastError: unknown,
      attempts = 0,
      cumulativeUpper = 0,
      personalTrustGroup: string | undefined;
    for (const candidate of ranked) {
      if (attempts >= this.policy.maxAttempts || Date.now() >= adaptiveDeadlineAt) break;
      const config = normalizeProfileConfig(candidate.row.config, `profile-${candidate.row.id}`);
      if (
        request.sensitivity === 'personal' &&
        personalTrustGroup &&
        config.trustGroup !== personalTrustGroup
      )
        continue;
      if (cumulativeUpper + candidate.expectedCostUsd > env.maxCost) {
        lastError = new PoolError(
          'BUDGET_LIMIT',
          'Không thể failover vì tổng mức dự phòng sẽ vượt giới hạn chi phí mỗi lượt.',
        );
        continue;
      }
      if (request.sensitivity === 'personal' && !personalTrustGroup)
        personalTrustGroup = config.trustGroup;
      attempts++;
      cumulativeUpper += candidate.expectedCostUsd;
      try {
        return await this.invoke(candidate.row, { ...request, requestId }, 'chat', {
          requestId,
          attemptNo: attempts,
          lane,
          score: candidate.score,
          scoreSnapshot,
          deadlineAt: adaptiveDeadlineAt,
        });
      } catch (error) {
        lastError = error;
        if (
          !(error instanceof PoolAttemptError) ||
          error.committed ||
          error.callerAborted ||
          !isAdaptiveRetryable(error.code)
        )
          throw error;
      }
    }
    throw (
      lastError ||
      new PoolError('NO_API_AVAILABLE', 'Không còn API sẵn sàng trong thời gian chờ của gateway.')
    );
  }

  startHealthMonitor() {
    if (this.probeTimer) return;
    this.probeTimer = setInterval(() => {
      void this.runHealthProbes().catch((error) =>
        this.logger.error(
          JSON.stringify({
            event: 'api_gateway_probe_cycle_failed',
            error: error instanceof Error ? error.name : 'unknown',
          }),
        ),
      );
    }, 60_000);
    this.probeTimer.unref();
  }

  stopHealthMonitor() {
    if (this.probeTimer) clearInterval(this.probeTimer);
    this.probeTimer = undefined;
  }

  async runHealthProbes() {
    await this.refresh();
    if (!this.routing.enabled || this.policy.mode === 'off' || !this.policy.probeIntervalMinutes)
      return { probed: 0 };
    let probed = 0;
    for (const id of new Set([...this.routing.simple, ...this.routing.complex])) {
      const row = await this.row(id);
      try {
        this.checkUsable(row, true);
      } catch {
        continue;
      }
      await this.gatewayState(row);
      const claimToken = randomUUID();
      const [claimed] = await this.db.query(
        `UPDATE provider_gateway_state
         SET probe_claim_token=$3,probe_claim_until=now()+($4 * interval '1 millisecond'),updated_at=now()
         WHERE provider_id=$1 AND revision=$2 AND next_probe_at<=now()
           AND (probe_claim_until IS NULL OR probe_claim_until<=now())
         RETURNING provider_id`,
        [
          row.id,
          row.revision,
          claimToken,
          normalizeProfileConfig(row.config, `profile-${row.id}`).timeoutMs + 60_000,
        ],
      );
      if (!claimed) continue;
      const lane = this.routing.simple.includes(id) ? 'simple' : 'complex';
      try {
        await this.invoke(
          row,
          {
            requestId: `probe-${randomUUID()}`,
            sensitivity: 'public',
            question: 'Kiểm tra khả năng phản hồi ngắn gọn của API.',
            evidence:
              'DỮ LIỆU GIẢ kiểm tra sức khỏe: chỉ trả lời xác nhận hệ thống có thể tạo văn bản tiếng Việt.',
            complex: lane === 'complex',
          },
          'probe',
        );
        probed++;
      } catch {
        // Circuit telemetry is updated by invoke; a probe failure must not stop the cycle.
      } finally {
        await this.db.query(
          `UPDATE provider_gateway_state
           SET next_probe_at=now()+($4 * interval '1 minute'),probe_claim_token=NULL,
               probe_claim_until=NULL,updated_at=now()
           WHERE provider_id=$1 AND revision=$2 AND probe_claim_token=$3`,
          [row.id, row.revision, claimToken, this.policy.probeIntervalMinutes],
        );
      }
    }
    return { probed };
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
    await this.pool.refresh();
    if (this.pool.currentRouting.enabled) return this.pool.generate(request);
    return this.fallback.generate(request);
  }
}
