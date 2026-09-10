import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (!existsSync('.env')) {
  const env = readFileSync('.env.example', 'utf8')
    .replace('SESSION_SECRET=', 'SESSION_SECRET=' + randomBytes(48).toString('hex'))
    .replace('DEMO_PASSWORD=', 'DEMO_PASSWORD=NauDemo2026!')
    .replace('ADMIN_PASSWORD=', 'ADMIN_PASSWORD=' + randomBytes(15).toString('base64url'));
  writeFileSync('.env', env);
  console.log('Created .env. Demo: sv001 / NauDemo2026!; admin password is in .env.');
}
mkdirSync('.data', { recursive: true });
