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
      'CREATE TABLE IF NOT EXISTS api_profiles(id text PRIMARY KEY, config jsonb NOT NULL, encrypted_key text, revision integer NOT NULL DEFAULT 1, last_test jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())',
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
  async cleanup() {
    await this.query(
      "DELETE FROM conversations WHERE updated_at < now() - ($1 * interval '1 day')",
      [env.retention],
    );
    await this.query('DELETE FROM sessions WHERE expires_at < now()');
    await this.query('DELETE FROM oidc_states WHERE expires_at < now()');
    await this.query("DELETE FROM audit WHERE created_at < now() - ($1 * interval '1 day')", [
      env.retention * 3,
    ]);
    await this.query(
      'DELETE FROM feedback WHERE conversation_id NOT IN (SELECT id FROM conversations)',
    );
  }
}
export const tokenHash = (s: string) => createHash('sha256').update(s).digest('hex');
