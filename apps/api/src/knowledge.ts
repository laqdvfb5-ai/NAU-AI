import { type Citation, type EmbeddingProvider } from '@nau/domain';
import { Database } from './database.js';
import type { KnowledgeSource } from './sources.js';
import { retrievalTerms, relevantSource } from './dialogue.js';
export class KnowledgeService {
  constructor(
    private db: Database,
    public embedding?: EmbeddingProvider,
  ) {}
  async sources() {
    return (
      await this.db.query<{ data: KnowledgeSource }>('SELECT data FROM sources ORDER BY id')
    ).map((x) => x.data);
  }
  async search(
    question: string,
    admittedAt?: string,
    asOf = new Date().toISOString().slice(0, 10),
  ) {
    const query = retrievalTerms(question).terms.join(' | ');
    if (!query) return [];
    const filter =
      "s.data->>'status'='active' AND s.data->>'reviewed'='true' AND ((s.data->>'effectiveFrom') IS NULL OR (s.data->>'effectiveFrom')<=$2) AND ($3::text IS NULL OR (s.data->>'admissionAfter') IS NULL OR (s.data->>'admissionAfter')<$3)";
    const lexical = await this.db.query(
      `SELECT c.id,c.text,c.metadata,c.source_id,ts_rank(to_tsvector('simple',c.search_text),to_tsquery('simple',$1)) AS score FROM chunks c JOIN sources s ON s.id=c.source_id WHERE ${filter} AND to_tsvector('simple',c.search_text) @@ to_tsquery('simple',$1) ORDER BY score DESC LIMIT 12`,
      [query, asOf, admittedAt || null],
    );
    let semantic: Record<string, any>[] = [];
    if (this.embedding) {
      const [{ count }] = await this.db.query(
        'SELECT count(*) FROM embeddings WHERE model=$1 AND dimensions=$2',
        [this.embedding.model, this.embedding.dimensions],
      );
      if (Number(count) > 0) {
        const { vectors } = await this.embedding.embed([question]);
        semantic = await this.db.query(
          `SELECT c.id,c.text,c.metadata,c.source_id,1-(e.embedding <=> $1::vector) AS score FROM embeddings e JOIN chunks c ON c.id=e.chunk_id JOIN sources s ON s.id=c.source_id WHERE ${filter} AND e.model=$4 AND e.dimensions=$5 AND 1-(e.embedding <=> $1::vector)>0.35 ORDER BY e.embedding <=> $1::vector LIMIT 12`,
          [
            JSON.stringify(vectors[0]),
            asOf,
            admittedAt || null,
            this.embedding.model,
            this.embedding.dimensions,
          ],
        );
      }
    }
    const scores = new Map<string, { row: Record<string, any>; score: number }>();
    for (const list of [lexical, semantic])
      list.forEach((r, i) =>
        scores.set(r.id, { row: r, score: (scores.get(r.id)?.score || 0) + 1 / (60 + i + 1) }),
      );
    const seen = new Set<string>();
    return [...scores.values()]
      .sort((a, b) => b.score - a.score)
      .map((x) => x.row)
      .filter((r) => relevantSource(question, r.text, r.metadata.title))
      .filter((r) => {
        if (seen.has(r.source_id)) return false;
        seen.add(r.source_id);
        return true;
      })
      .slice(0, 3)
      .map((r) => ({
        text: r.text,
        citation: {
          id: r.source_id,
          title: r.metadata.title,
          url: r.metadata.url,
          version: r.metadata.version,
          page: r.metadata.page,
          article: r.metadata.article,
          excerpt: r.text,
        } as Citation,
      }));
  }
  async reindex() {
    if (!this.embedding) throw new Error('Embedding chưa được cấu hình.');
    let count = 0;
    const rows = await this.db.query(
      "SELECT c.id,c.text FROM chunks c JOIN sources s ON c.source_id=s.id WHERE s.data->>'status'='active'",
    );
    for (let i = 0; i < rows.length; i += 16) {
      const batch = rows.slice(i, i + 16);
      const { vectors } = await this.embedding.embed(batch.map((r) => r.text));
      for (let j = 0; j < batch.length; j++) {
        await this.db.query(
          'INSERT INTO embeddings(chunk_id,model,dimensions,embedding) VALUES($1,$2,$3,$4::vector) ON CONFLICT(chunk_id) DO UPDATE SET model=excluded.model,dimensions=excluded.dimensions,embedding=excluded.embedding',
          [
            batch[j].id,
            this.embedding.model,
            this.embedding.dimensions,
            JSON.stringify(vectors[j]),
          ],
        );
        count++;
      }
    }
    return count;
  }
}
