import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { hash } from 'bcryptjs';
import {
  generateStudents,
  normalize,
  type Identity,
  type Student,
  type StudentDataProvider,
} from '@nau/domain';
import { env, dataDir } from './config.js';
import { initialSources, initialRules } from './sources.js';

export interface ProviderGatewayLease {
  providerId: string;
  revision: number;
  slot: number;
  requestId: string;
  expiresAt: string;
}

export interface AcquireProviderGatewayLeaseInput {
  providerId: string;
  revision: number;
  maxConcurrent: number;
  requestId: string;
  ttlMs: number;
}

export type DatabaseQuery = <T = Record<string, any>>(
  sql: string,
  params?: unknown[],
) => Promise<T[]>;

export class Database implements StudentDataProvider {
  private engine: PGlite | pg.Pool;
  constructor(options: { memory?: boolean } = {}) {
    this.engine = options.memory
      ? new PGlite({ extensions: { vector } })
      : env.databaseUrl
        ? new pg.Pool({ connectionString: env.databaseUrl, max: 15 })
        : new PGlite(resolve(dataDir, 'postgres'), { extensions: { vector } });
  }
  async query<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result =
      this.engine instanceof pg.Pool
        ? await this.engine.query(sql, params)
        : await this.engine.query(sql, params);
    return result.rows as T[];
  }
  async transaction<T>(callback: (query: DatabaseQuery) => Promise<T>): Promise<T> {
    if (this.engine instanceof pg.Pool) {
      const client = await this.engine.connect();
      try {
        await client.query('BEGIN');
        const value = await callback(
          async <R = Record<string, any>>(sql: string, params: unknown[] = []) =>
            (await client.query(sql, params)).rows as R[],
        );
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    return this.engine.transaction((tx) =>
      callback(
        async <R = Record<string, any>>(sql: string, params: unknown[] = []) =>
          (await tx.query<R>(sql, params)).rows as R[],
      ),
    );
  }
  async close() {
    if (this.engine instanceof pg.Pool) await this.engine.end();
    else await this.engine.close();
  }
  async initialize() {
    const statements = [
      'CREATE EXTENSION IF NOT EXISTS vector',
      'CREATE TABLE IF NOT EXISTS students(id text PRIMARY KEY, data jsonb NOT NULL)',
      'CREATE TABLE IF NOT EXISTS accounts(id text PRIMARY KEY, username text UNIQUE NOT NULL, password_hash text NOT NULL, identity jsonb NOT NULL)',
      'CREATE TABLE IF NOT EXISTS sessions(token_hash text PRIMARY KEY, identity jsonb, expires_at timestamptz NOT NULL)',
      'CREATE TABLE IF NOT EXISTS conversations(id text PRIMARY KEY, owner_hash text NOT NULL, title text NOT NULL, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())',
      'CREATE TABLE IF NOT EXISTS messages(id text PRIMARY KEY, conversation_id text REFERENCES conversations(id) ON DELETE CASCADE, role text NOT NULL, data jsonb NOT NULL, created_at timestamptz DEFAULT now())',
      'CREATE INDEX IF NOT EXISTS conversation_owner_idx ON conversations(owner_hash)',
      'CREATE TABLE IF NOT EXISTS sources(id text PRIMARY KEY, data jsonb NOT NULL)',
      'CREATE TABLE IF NOT EXISTS source_versions(id text PRIMARY KEY, source_id text NOT NULL, data jsonb NOT NULL, created_at timestamptz DEFAULT now())',
      'CREATE TABLE IF NOT EXISTS chunks(id text PRIMARY KEY, source_id text REFERENCES sources(id) ON DELETE CASCADE, text text NOT NULL, search_text text NOT NULL, metadata jsonb NOT NULL)',
      "CREATE INDEX IF NOT EXISTS chunks_fts_idx ON chunks USING gin(to_tsvector('simple',search_text))",
      'CREATE TABLE IF NOT EXISTS embeddings(chunk_id text PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE, model text NOT NULL, dimensions integer NOT NULL, embedding vector NOT NULL)',
      'CREATE TABLE IF NOT EXISTS rules(id text PRIMARY KEY, data jsonb NOT NULL)',
      'CREATE TABLE IF NOT EXISTS settings(key text PRIMARY KEY, value jsonb NOT NULL)',
      'CREATE TABLE IF NOT EXISTS audit(id text PRIMARY KEY, actor text NOT NULL, event text NOT NULL, metadata jsonb NOT NULL, created_at timestamptz DEFAULT now())',
      'CREATE TABLE IF NOT EXISTS usage(id text PRIMARY KEY, model text NOT NULL, input_tokens integer NOT NULL DEFAULT 0, output_tokens integer NOT NULL DEFAULT 0, cost_usd numeric NOT NULL DEFAULT 0, reserved_usd numeric NOT NULL DEFAULT 0, status text NOT NULL, created_at timestamptz DEFAULT now())',
      'ALTER TABLE usage ADD COLUMN IF NOT EXISTS provider_id text',
      'ALTER TABLE usage ADD COLUMN IF NOT EXISTS purpose text',
      'ALTER TABLE usage ADD COLUMN IF NOT EXISTS latency_ms integer',
      'ALTER TABLE usage ADD COLUMN IF NOT EXISTS request_id text',
      'ALTER TABLE usage ADD COLUMN IF NOT EXISTS attempt_no integer',
      'ALTER TABLE usage ADD COLUMN IF NOT EXISTS lane text',
      'ALTER TABLE usage ADD COLUMN IF NOT EXISTS first_token_ms integer',
      'ALTER TABLE usage ADD COLUMN IF NOT EXISTS error_code text',
      'CREATE INDEX IF NOT EXISTS usage_provider_purpose_created_idx ON usage(provider_id,purpose,created_at)',
      'CREATE INDEX IF NOT EXISTS usage_request_attempt_idx ON usage(request_id,attempt_no)',
      'CREATE TABLE IF NOT EXISTS api_profiles(id text PRIMARY KEY, config jsonb NOT NULL, encrypted_key text, revision integer NOT NULL DEFAULT 1, last_test jsonb, last_success_revision integer, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())',
      'ALTER TABLE api_profiles ADD COLUMN IF NOT EXISTS last_success_revision integer',
      "UPDATE api_profiles SET last_success_revision=revision WHERE last_success_revision IS NULL AND NOT EXISTS (SELECT 1 FROM settings WHERE key='migration_api_profile_last_success_revision_v1') AND ((last_test->>'ok'='true' AND last_test->>'kind'='completion' AND last_test->>'revision'=revision::text) OR EXISTS (SELECT 1 FROM usage WHERE usage.provider_id=api_profiles.id AND usage.purpose='test' AND usage.status IN ('completed','usage_unknown') AND usage.created_at>=api_profiles.updated_at))",
      "INSERT INTO settings(key,value) VALUES('migration_api_profile_last_success_revision_v1','true'::jsonb) ON CONFLICT DO NOTHING",
      "UPDATE api_profiles SET config=jsonb_set(config,'{allowPersonalData}','true'::jsonb,true) WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key='migration_api_profile_privacy_defaults_v1') AND jsonb_typeof(config->'allowPersonalData') IS DISTINCT FROM 'boolean'",
      "UPDATE api_profiles SET config=jsonb_set(config,'{trustGroup}',to_jsonb('profile-' || id),true) WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key='migration_api_profile_privacy_defaults_v1') AND (jsonb_typeof(config->'trustGroup') IS DISTINCT FROM 'string' OR btrim(config->>'trustGroup')='')",
      "INSERT INTO settings(key,value) VALUES('migration_api_profile_privacy_defaults_v1','true'::jsonb) ON CONFLICT DO NOTHING",
      "CREATE TABLE IF NOT EXISTS provider_gateway_state(provider_id text NOT NULL REFERENCES api_profiles(id) ON DELETE CASCADE, revision integer NOT NULL, success_count bigint NOT NULL DEFAULT 0, failure_count bigint NOT NULL DEFAULT 0, consecutive_failures integer NOT NULL DEFAULT 0, success_ewma double precision NOT NULL DEFAULT 1, latency_ewma_ms double precision, first_token_ewma_ms double precision, cost_ewma_usd double precision, quality_ewma double precision, circuit_state text NOT NULL DEFAULT 'closed', circuit_open_until timestamptz, next_probe_at timestamptz NOT NULL DEFAULT now(), probe_claim_until timestamptz, probe_claim_token text, last_error_code text, last_attempt_at timestamptz, last_success_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(provider_id,revision))",
      'CREATE INDEX IF NOT EXISTS provider_gateway_state_circuit_idx ON provider_gateway_state(circuit_state,circuit_open_until)',
      'CREATE TABLE IF NOT EXISTS provider_gateway_leases(provider_id text NOT NULL REFERENCES api_profiles(id) ON DELETE CASCADE, revision integer NOT NULL, slot integer NOT NULL, request_id text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(provider_id,revision,slot))',
      'CREATE INDEX IF NOT EXISTS provider_gateway_leases_expires_idx ON provider_gateway_leases(expires_at)',
      "CREATE TABLE IF NOT EXISTS gateway_attempts(id text PRIMARY KEY, request_id text NOT NULL, attempt_no integer NOT NULL, lane text NOT NULL, purpose text NOT NULL DEFAULT 'chat', provider_id text NOT NULL, provider_revision integer NOT NULL, model text NOT NULL, status text NOT NULL DEFAULT 'started', error_code text, retryable boolean, committed boolean NOT NULL DEFAULT false, sensitivity text, selection_score double precision, selection_reason jsonb NOT NULL DEFAULT '{}'::jsonb, latency_ms integer, first_token_ms integer, input_tokens integer NOT NULL DEFAULT 0, output_tokens integer NOT NULL DEFAULT 0, cost_usd numeric NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, UNIQUE(request_id,attempt_no))",
      'CREATE INDEX IF NOT EXISTS gateway_attempts_request_idx ON gateway_attempts(request_id,attempt_no)',
      'CREATE INDEX IF NOT EXISTS gateway_attempts_provider_created_idx ON gateway_attempts(provider_id,provider_revision,created_at)',
      'CREATE INDEX IF NOT EXISTS gateway_attempts_created_idx ON gateway_attempts(created_at)',
      'CREATE TABLE IF NOT EXISTS budget_lock(id integer PRIMARY KEY)',
      'INSERT INTO budget_lock(id) VALUES(1) ON CONFLICT DO NOTHING',
      'CREATE TABLE IF NOT EXISTS feedback(id text PRIMARY KEY, conversation_id text NOT NULL, message_id text NOT NULL, rating integer NOT NULL, note text NOT NULL, created_at timestamptz DEFAULT now(), UNIQUE(conversation_id,message_id))',
      'CREATE TABLE IF NOT EXISTS oidc_states(state_hash text PRIMARY KEY, data jsonb NOT NULL, expires_at timestamptz NOT NULL)',
    ];
    for (const sql of statements) await this.query(sql);
    if (env.synthetic && (await this.count()) === 0)
      await this.seed(Number(process.env.SEED_COUNT || 120));
    for (const s of initialSources) {
      const inserted = await this.query(
        'INSERT INTO sources(id,data) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id',
        [s.id, JSON.stringify(s)],
      );
      if (inserted.length && s.status === 'active') await this.indexSource(s.id, s.excerpt, s);
    }
    for (const r of initialRules)
      await this.query('INSERT INTO rules(id,data) VALUES($1,$2) ON CONFLICT DO NOTHING', [
        r.id,
        JSON.stringify(r),
      ]);
  }
  async seed(count: number) {
    if (!env.synthetic) throw new Error('Cannot seed real-data mode');
    const students = generateStudents(count);
    const demoHash = await hash(process.env.DEMO_PASSWORD || 'disabled-' + randomUUID(), 10);
    for (let start = 0; start < students.length; start += 100) {
      const batch = students.slice(start, start + 100);
      await this.query(
        'INSERT INTO students(id,data) SELECT x.id,x.data FROM jsonb_to_recordset($1::jsonb) AS x(id text,data jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
        [JSON.stringify(batch.map((s) => ({ id: s.id, data: s })))],
      );
      await this.query(
        'INSERT INTO accounts(id,username,password_hash,identity) SELECT x.id,x.username,x.password_hash,x.identity FROM jsonb_to_recordset($1::jsonb) AS x(id text,username text,password_hash text,identity jsonb) ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash,identity=excluded.identity',
        [
          JSON.stringify(
            batch.map((s, j) => ({
              id: s.id,
              username: `sv${String(start + j + 1).padStart(3, '0')}`,
              password_hash: demoHash,
              identity: {
                accountId: s.id,
                studentId: s.id,
                role: 'student',
                displayName: s.name,
              } satisfies Identity,
            })),
          ),
        ],
      );
    }
    if (process.env.ADMIN_PASSWORD) {
      const h = await hash(process.env.ADMIN_PASSWORD, 12);
      await this.query(
        'INSERT INTO accounts(id,username,password_hash,identity) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash',
        [
          'admin',
          'admin',
          h,
          JSON.stringify({
            accountId: 'admin',
            role: 'admin',
            displayName: 'Quản trị viên',
          } satisfies Identity),
        ],
      );
    }
    return students.length;
  }
  async getStudent(id: string) {
    const rows = await this.query<{ data: Student }>('SELECT data FROM students WHERE id=$1', [id]);
    return rows[0]?.data || null;
  }
  async count() {
    return Number((await this.query('SELECT count(*) AS count FROM students'))[0].count);
  }
  async indexSource(id: string, text: string, metadata: unknown) {
    await this.query('DELETE FROM chunks WHERE source_id=$1', [id]);
    const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
    let pieces: string[] = [];
    for (const p of paragraphs) {
      for (let i = 0; i < p.length; i += 1400) pieces.push(p.slice(i, i + 1600));
    }
    for (let i = 0; i < pieces.length; i++)
      await this.query(
        'INSERT INTO chunks(id,source_id,text,search_text,metadata) VALUES($1,$2,$3,$4,$5)',
        [`${id}:${i}`, id, pieces[i], normalize(pieces[i]), JSON.stringify(metadata)],
      );
  }
  async audit(actor: string, event: string, metadata: Record<string, unknown> = {}) {
    await this.query('INSERT INTO audit(id,actor,event,metadata) VALUES($1,$2,$3,$4)', [
      randomUUID(),
      actor,
      event,
      JSON.stringify(metadata),
    ]);
  }
  async acquireProviderGatewayLease({
    providerId,
    revision,
    maxConcurrent,
    requestId,
    ttlMs,
  }: AcquireProviderGatewayLeaseInput): Promise<ProviderGatewayLease | null> {
    if (!Number.isInteger(revision) || revision < 1) throw new Error('Invalid provider revision');
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 1000)
      throw new Error('Invalid provider concurrency');
    if (!requestId) throw new Error('Invalid gateway request id');
    if (!Number.isFinite(ttlMs) || ttlMs < 1 || ttlMs > 3_600_000)
      throw new Error('Invalid provider lease TTL');
    for (let slot = 1; slot <= maxConcurrent; slot++) {
      const [lease] = await this.query<{
        provider_id: string;
        revision: number;
        slot: number;
        request_id: string;
        expires_at: Date | string;
      }>(
        `INSERT INTO provider_gateway_leases(provider_id,revision,slot,request_id,expires_at)
         SELECT profile.id,profile.revision,$3,$4,now()+($5 * interval '1 millisecond')
         FROM (
           SELECT id,revision FROM api_profiles
           WHERE id=$1 AND revision=$2
           FOR KEY SHARE
         ) profile
         LEFT JOIN provider_gateway_state state
           ON state.provider_id=profile.id AND state.revision=profile.revision
         WHERE state.provider_id IS NULL OR state.circuit_state<>'open'
           OR (state.circuit_open_until IS NOT NULL AND state.circuit_open_until<=now())
         ON CONFLICT(provider_id,revision,slot) DO UPDATE
         SET request_id=excluded.request_id,expires_at=excluded.expires_at,created_at=now()
         WHERE provider_gateway_leases.expires_at<=now()
         RETURNING provider_id,revision,slot,request_id,expires_at`,
        [providerId, revision, slot, requestId, Math.ceil(ttlMs)],
      );
      if (lease)
        return {
          providerId: lease.provider_id,
          revision: Number(lease.revision),
          slot: Number(lease.slot),
          requestId: lease.request_id,
          expiresAt: new Date(lease.expires_at).toISOString(),
        };
    }
    return null;
  }
  async renewProviderGatewayLease(lease: ProviderGatewayLease, ttlMs: number) {
    if (!Number.isFinite(ttlMs) || ttlMs < 1 || ttlMs > 3_600_000)
      throw new Error('Invalid provider lease TTL');
    const rows = await this.query(
      "UPDATE provider_gateway_leases SET expires_at=now()+($5 * interval '1 millisecond') WHERE provider_id=$1 AND revision=$2 AND slot=$3 AND request_id=$4 AND expires_at>now() RETURNING provider_id",
      [lease.providerId, lease.revision, lease.slot, lease.requestId, Math.ceil(ttlMs)],
    );
    return rows.length > 0;
  }
  async releaseProviderGatewayLease(lease: ProviderGatewayLease) {
    const rows = await this.query(
      'DELETE FROM provider_gateway_leases WHERE provider_id=$1 AND revision=$2 AND slot=$3 AND request_id=$4 RETURNING provider_id',
      [lease.providerId, lease.revision, lease.slot, lease.requestId],
    );
    return rows.length > 0;
  }
  async cleanup() {
    await this.query(
      "DELETE FROM conversations WHERE updated_at < now() - ($1 * interval '1 day')",
      [env.retention],
    );
    await this.query('DELETE FROM sessions WHERE expires_at < now()');
    await this.query('DELETE FROM oidc_states WHERE expires_at < now()');
    await this.query('DELETE FROM provider_gateway_leases WHERE expires_at <= now()');
    await this.query(
      "DELETE FROM gateway_attempts WHERE created_at < now() - ($1 * interval '1 day')",
      [env.retention * 3],
    );
    await this.query(
      "DELETE FROM provider_gateway_state state WHERE NOT EXISTS (SELECT 1 FROM api_profiles profile WHERE profile.id=state.provider_id AND profile.revision=state.revision) AND state.updated_at < now() - interval '7 days'",
    );
    await this.query("DELETE FROM audit WHERE created_at < now() - ($1 * interval '1 day')", [
      env.retention * 3,
    ]);
    await this.query(
      'DELETE FROM feedback WHERE conversation_id NOT IN (SELECT id FROM conversations)',
    );
  }
}
export const tokenHash = (s: string) => createHash('sha256').update(s).digest('hex');
