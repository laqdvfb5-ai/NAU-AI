import { cp, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  web = resolve(root, 'apps/web'),
  output = resolve(web, '.next/standalone/apps/web');
try {
  await access(resolve(output, 'server.js'));
} catch {
  throw new Error('Run npm run build before npm start.');
}
await cp(resolve(web, '.next/static'), resolve(output, '.next/static'), { recursive: true });
await cp(resolve(web, 'public'), resolve(output, 'public'), { recursive: true });
const child = spawn(process.execPath, [resolve(output, 'server.js')], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env: {
    ...process.env,
    HOSTNAME: process.env.WEB_HOST || '127.0.0.1',
    PORT: process.env.WEB_PORT || '3000',
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code || 0));
