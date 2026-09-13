import { mkdir, writeFile } from 'node:fs/promises';
import { STUDENT_FAQ_CATEGORIES, STUDENT_FAQ_QUESTIONS } from '@nau/domain';
import { Database } from '../apps/api/src/database.js';
import { KnowledgeService } from '../apps/api/src/knowledge.js';

// An isolated source-coverage report: no live provider calls and no production mutations.
const db = new Database({ memory: true });
try {
  await db.initialize();
  const kb = new KnowledgeService(db);
  const cases = [];
  for (const entry of STUDENT_FAQ_QUESTIONS) {
    const hits = entry.dataScope === 'public' ? await kb.search(entry.question) : [];
    cases.push({
      ...entry,
      status:
        entry.dataScope === 'personal'
          ? 'requires_authorized_records'
          : hits.length
            ? 'related_sources_require_answer_review'
            : 'source_gap',
      sources: hits.map((hit) => hit.citation),
      institutionReviewed: false,
    });
  }
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'seeded_source_coverage',
    liveModelEvaluated: false,
    note: 'Related sources do not prove a complete answer. Review each requiredSource before grading live answers.',
    total: cases.length,
    categories: STUDENT_FAQ_CATEGORIES.map((group) => ({
      ...group,
      total: cases.filter((c) => c.categoryId === group.id).length,
      sourceGaps: cases.filter((c) => c.categoryId === group.id && c.status === 'source_gap')
        .length,
    })),
    cases,
  };
  await mkdir('reports', { recursive: true });
  await writeFile('reports/student-faq-coverage.json', JSON.stringify(report, null, 2));
  await writeFile(
    'reports/student-faq-cases.jsonl',
    cases.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
  );
  console.log(
    `${cases.length} FAQ questions / ${report.categories.length} categories; ${cases.filter((c) => c.status === 'source_gap').length} source gaps. Live model evaluated: false. Reports: reports/student-faq-coverage.json, reports/student-faq-cases.jsonl`,
  );
} finally {
  await db.close();
}
