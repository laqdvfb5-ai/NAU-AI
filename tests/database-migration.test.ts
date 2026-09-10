import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Database } from '../apps/api/src/database.js';

test('API profile readiness migration recovers only tests for the current configuration', async () => {
  const db = new Database({ memory: true });
  const currentHistoryId = randomUUID();
  const staleHistoryId = randomUUID();
  const currentLastTestId = randomUUID();

  try {
    await db.initialize();
    await db.query(
      `INSERT INTO api_profiles(id,config,revision,last_test,updated_at)
       VALUES
         ($1,'{}',3,$4,now()-interval '2 minutes'),
         ($2,'{}',4,$5,now()),
         ($3,'{}',5,$6,now())`,
      [
        currentHistoryId,
        staleHistoryId,
        currentLastTestId,
        JSON.stringify({ ok: false, kind: 'completion', revision: 3, errorCode: 'UPSTREAM_ERROR' }),
        JSON.stringify({ ok: false, kind: 'completion', revision: 4, errorCode: 'UPSTREAM_ERROR' }),
        JSON.stringify({ ok: true, kind: 'completion', revision: 5 }),
      ],
    );
    await db.query(
      `INSERT INTO usage(id,model,status,provider_id,purpose,created_at)
       VALUES
         ($1,'fixture','completed',$3,'test',now()-interval '1 minute'),
         ($2,'fixture','usage_unknown',$4,'test',now()-interval '1 minute')`,
      [randomUUID(), randomUUID(), currentHistoryId, staleHistoryId],
    );
    await db.query(
      "DELETE FROM settings WHERE key='migration_api_profile_last_success_revision_v1'",
    );

    await db.initialize();

    const profiles = await db.query<{ id: string; last_success_revision: number | null }>(
      'SELECT id,last_success_revision FROM api_profiles WHERE id=ANY($1::text[]) ORDER BY id',
      [[currentHistoryId, staleHistoryId, currentLastTestId]],
    );
    const readiness = new Map(
      profiles.map((profile) => [profile.id, profile.last_success_revision]),
    );
    assert.equal(readiness.get(currentHistoryId), 3);
    assert.equal(readiness.get(staleHistoryId), null);
    assert.equal(readiness.get(currentLastTestId), 5);

    const indexes = await db.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename='usage' AND indexname='usage_provider_purpose_created_idx'",
    );
    assert.equal(indexes.length, 1);

    await db.query('UPDATE api_profiles SET last_success_revision=NULL WHERE id=$1', [
      currentHistoryId,
    ]);
    await db.initialize();
    const [afterRestart] = await db.query<{ last_success_revision: number | null }>(
      'SELECT last_success_revision FROM api_profiles WHERE id=$1',
      [currentHistoryId],
    );
    assert.equal(afterRestart.last_success_revision, null);
  } finally {
    await db.close();
  }
});
