import { Database } from '../apps/api/src/database.js';
import { assertConfig } from '../apps/api/src/config.js';
assertConfig();
const count = Number(process.argv.find((x) => x.startsWith('--count='))?.split('=')[1] || 120);
const db = new Database();
try {
  await db.initialize();
  console.log(
    `Upserted ${await db.seed(count)} synthetic students. Existing conversations are retained.`,
  );
} finally {
  await db.close();
}
