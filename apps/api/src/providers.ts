import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import type { EmbeddingProvider, LLMProvider, LLMRequest, LLMResponse } from '@nau/domain';
import { Database } from './database.js';
import { env } from './config.js';
import { modelMessages } from './dialogue.js';

export interface BudgetReservationMetadata {
  providerId?: string;
  purpose?: string;
  /** Correlates one logical model request across adaptive gateway attempts. */
  requestId?: string;
  /** One-based attempt number within requestId. */
  attemptNo?: number;
  lane?: 'simple' | 'complex';
}

export interface BudgetCompletionMetadata {
  latencyMs?: number;
  firstTokenMs?: number;
  errorCode?: string;
}

export class Budget {
  constructor(private db: Database) {}
  async reserve(model: string, amount: number, metadata: BudgetReservationMetadata = {}) {
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Chi phí dự phòng không hợp lệ.');
    if (amount > env.maxCost) throw new Error('Câu hỏi vượt giới hạn chi phí mỗi lượt.');
    const key = 'budget:' + new Date().toISOString().slice(0, 7);
    await this.db.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT DO NOTHING', [
      key,
      '0',
    ]);
    const rows = await this.db.query(
      'UPDATE settings SET value=to_jsonb((value::text)::numeric+$2::numeric) WHERE key=$1 AND (value::text)::numeric+$2::numeric<=$3::numeric RETURNING key',
      [key, amount, env.budget],
    );
    if (!rows.length)
      throw new Error('Đã chạm giới hạn ngân sách tháng. Vui lòng liên hệ quản trị viên.');
    const id = randomUUID();
    await this.db.query(
      'INSERT INTO usage(id,model,reserved_usd,status,provider_id,purpose,request_id,attempt_no,lane) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        id,
        model,
        amount,
        'reserved',
        metadata.providerId || null,
        metadata.purpose || null,
        metadata.requestId || null,
        metadata.attemptNo ?? null,
        metadata.lane || null,
      ],
    );
    return { id, key, amount };
  }
  async finish(
    reservation: { id: string; key: string; amount: number },
    input: number,
    output: number,
    cost: number,
    status = 'completed',
    metadata: BudgetCompletionMetadata = {},
  ) {
    await this.db.query(
      'UPDATE usage SET input_tokens=$2,output_tokens=$3,cost_usd=$4,reserved_usd=0,status=$5,latency_ms=coalesce($6,latency_ms),first_token_ms=coalesce($7,first_token_ms),error_code=coalesce($8,error_code) WHERE id=$1',
      [
        reservation.id,
        input,
        output,
        cost,
        status,
        metadata.latencyMs ?? null,
        metadata.firstTokenMs ?? null,
        metadata.errorCode || null,
      ],
    );
    await this.db.query(
      'UPDATE settings SET value=to_jsonb(greatest(0,(value::text)::numeric+$2::numeric)) WHERE key=$1',
      [reservation.key, cost - reservation.amount],
    );
  }
}
export class EvidenceProvider implements LLMProvider {
  mode = 'evidence';
  async generate(_req: LLMRequest): Promise<LLMResponse> {
    throw new Error('Chưa cấu hình model AI cho chat.');
  }
}
export class ConfigurableLLM implements LLMProvider {
  mode = env.llm;
  private client: OpenAI;
  constructor(private budget: Budget) {
    if (env.llm === 'openai' && !process.env.OPENAI_API_KEY)
      throw new Error('Thiếu OPENAI_API_KEY. Cấu hình key hoặc chọn API đã kiểm tra trong pool.');
    this.client = new OpenAI({
      apiKey: env.llm === 'local' ? 'local' : process.env.OPENAI_API_KEY,
      baseURL: env.llm === 'local' ? process.env.LOCAL_LLM_URL : undefined,
      maxRetries: 0,
      timeout: 25000,
    });
  }
  async generate(req: LLMRequest): Promise<LLMResponse> {
    const model =
      env.llm === 'local'
        ? process.env.LOCAL_LLM_MODEL || 'qwen3.5:9b'
        : req.complex
          ? process.env.LLM_COMPLEX_MODEL || 'gpt-5.6-terra'
          : process.env.LLM_SIMPLE_MODEL || 'gpt-5.6-luna';
    const inputRate =
        env.llm === 'local'
          ? 0
          : Number(
              process.env[req.complex ? 'COMPLEX_INPUT_USD_PER_M' : 'SIMPLE_INPUT_USD_PER_M'] || 2,
            ),
      outputRate =
        env.llm === 'local'
          ? 0
          : Number(
              process.env[req.complex ? 'COMPLEX_OUTPUT_USD_PER_M' : 'SIMPLE_OUTPUT_USD_PER_M'] ||
                12,
            );
    const messages = modelMessages(req);
    const estimatedUpper =
      (Buffer.byteLength(JSON.stringify(messages)) * inputRate + 1200 * outputRate) / 1e6;
    const reservation = await this.budget.reserve(model, estimatedUpper);
    try {
      const response = await this.client.chat.completions.create(
        {
          model,
          store: false,
          max_completion_tokens: 1200,
          stream: true,
          stream_options: { include_usage: true },
          messages,
        },
        { signal: req.signal },
      );
      let generated = '',
        usage: { prompt_tokens: number; completion_tokens: number } | null = null;
      for await (const chunk of response) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta) {
          generated += delta;
          req.onText?.(delta);
        }
        if (chunk.usage) usage = chunk.usage;
      }
      req.signal?.throwIfAborted();
      if (!generated.trim()) throw new Error('Model không trả về văn bản.');
      const input = usage?.prompt_tokens || 0,
        output = usage?.completion_tokens || 0;
      if (!usage) {
        await this.budget.finish(reservation, 0, 0, estimatedUpper, 'usage_unknown');
        return {
          text: generated,
          model,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: estimatedUpper,
        };
      }
      const cost = (input * inputRate + output * outputRate) / 1e6;
      await this.budget.finish(reservation, input, output, cost);
      return {
        text: generated,
        model,
        inputTokens: input,
        outputTokens: output,
        costUsd: cost,
      };
    } catch (error) {
      await this.budget.finish(reservation, 0, 0, estimatedUpper, 'provider_error_cost_unknown');
      throw error;
    }
  }
}
export class ConfigurableEmbedding implements EmbeddingProvider {
  model = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
  dimensions = Number(process.env.EMBEDDING_DIMENSIONS || 1536);
  private client: OpenAI;
  constructor(private budget: Budget) {
    this.client = new OpenAI({
      apiKey: env.embedding === 'local' ? 'local' : process.env.OPENAI_API_KEY,
      baseURL: env.embedding === 'local' ? process.env.LOCAL_EMBEDDING_URL : undefined,
      maxRetries: 0,
      timeout: 25000,
    });
  }
  async embed(texts: string[]) {
    const rate =
        env.embedding === 'local' ? 0 : Number(process.env.EMBEDDING_INPUT_USD_PER_M || 0.02),
      upper = (Buffer.byteLength(texts.join('')) * rate) / 1e6;
    const reservation = await this.budget.reserve(this.model, upper);
    try {
      const out = await this.client.embeddings.create({
        model: this.model,
        input: texts,
        ...(env.embedding === 'openai' ? { dimensions: this.dimensions } : {}),
      });
      const vectors = out.data.sort((a, b) => a.index - b.index).map((x) => x.embedding);
      if (vectors.some((v) => v.length !== this.dimensions))
        throw new Error('Kích thước embedding không đúng; cần cấu hình và lập chỉ mục lại.');
      await this.budget.finish(
        reservation,
        out.usage.total_tokens,
        0,
        (out.usage.total_tokens * rate) / 1e6,
      );
      return { vectors, tokens: out.usage.total_tokens };
    } catch (e) {
      await this.budget.finish(reservation, 0, 0, upper, 'provider_error_cost_unknown');
      throw e;
    }
  }
}
