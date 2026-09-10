import { config } from 'dotenv';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const cwd = process.cwd();
export const root =
  existsSync(resolve(cwd, '../../package.json')) && cwd.replaceAll('\\', '/').endsWith('/apps/api')
    ? resolve(cwd, '../..')
    : cwd;
config({ path: resolve(root, '.env'), quiet: true });
export const dataDir = resolve(root, process.env.DATA_DIR || '.data');
mkdirSync(dataDir, { recursive: true });
export const env = {
  port: Number(process.env.PORT || 4000),
  origin: process.env.WEB_ORIGIN || 'http://localhost:3000',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  databaseUrl: process.env.DATABASE_URL || '',
  redisUrl: process.env.REDIS_URL || '',
  production: process.env.NODE_ENV === 'production',
  synthetic: process.env.DATA_MODE !== 'real',
  demo: process.env.ALLOW_DEMO_LOGIN === 'true',
  retention: Number(process.env.RETENTION_DAYS || 30),
  llm: process.env.LLM_PROVIDER || 'evidence',
  embedding: process.env.EMBEDDING_PROVIDER || 'none',
  budget: Number(process.env.MONTHLY_BUDGET_USD || 20),
  maxCost: Number(process.env.MAX_REQUEST_COST_USD || 0.2),
};
export function assertConfig() {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
    throw new Error('Run npm run setup or supply SESSION_SECRET (32+ characters).');
  if (
    !Number.isFinite(env.retention) ||
    env.retention < 1 ||
    !Number.isFinite(env.budget) ||
    env.budget < 0 ||
    !Number.isFinite(env.maxCost) ||
    env.maxCost <= 0
  )
    throw new Error('Invalid retention/budget configuration.');
  if (env.demo && !env.synthetic) throw new Error('Demo login is forbidden for real student data.');
  if (
    !env.synthetic &&
    (!process.env.STUDENT_PROVIDER_MODULE ||
      !process.env.OIDC_ISSUER ||
      !process.env.OIDC_MAPPING_FILE)
  )
    throw new Error('Real data requires an explicit student adapter and reviewed SSO mapping.');
  if (env.llm === 'local' && env.embedding === 'openai')
    throw new Error('Local mode cannot send embeddings to an external provider.');
  if (!['evidence', 'openai', 'local'].includes(env.llm)) throw new Error('Unknown LLM_PROVIDER');
}
