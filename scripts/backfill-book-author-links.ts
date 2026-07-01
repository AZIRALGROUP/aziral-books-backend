/**
 * One-off backfill for the book_authors linking bug fixed in indexer.ts:
 * onConflictDoNothing().returning() only returns a row on actual insert, so
 * for every book after an author's first, the old code silently skipped
 * creating the book_authors link. Meili's per-document `authors` array was
 * never affected (indexInMeili always writes it from the aggregator's raw
 * data), so it's the source of truth here — walk every document and ensure
 * an authors row + book_authors link exists for each of its listed authors.
 *
 * Run: pnpm tsx scripts/backfill-book-author-links.ts
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { logger } from '../src/logger.js';
import { booksIndex, type BookSearchDoc } from '../src/search/meili.js';

const PAGE_SIZE = 1000;

async function getOrCreateAuthorId(name: string, source: string): Promise<string> {
  const sourceId = `${source}:${name}`;
  const [inserted] = await db
    .insert(schema.authors)
    .values({ name, source, sourceId })
    .onConflictDoNothing({ target: [schema.authors.source, schema.authors.sourceId] })
    .returning({ id: schema.authors.id });
  if (inserted) return inserted.id;

  const existing = await db.query.authors.findFirst({
    where: and(eq(schema.authors.source, source), eq(schema.authors.sourceId, sourceId)),
  });
  if (!existing) throw new Error(`author lookup failed after insert conflict: ${sourceId}`);
  return existing.id;
}

async function main(): Promise<void> {
  const allBooks = await db.query.books.findMany({ columns: { id: true, source: true } });
  const sourceById = new Map(allBooks.map((b) => [b.id, b.source]));
  logger.info({ books: sourceById.size }, 'loaded book sources from postgres');

  const index = booksIndex();
  let offset = 0;
  let scanned = 0;
  let linked = 0;
  let missingSource = 0;

  for (;;) {
    const result = await index.getDocuments<BookSearchDoc>({ limit: PAGE_SIZE, offset });
    const hits = result.results;
    if (hits.length === 0) break;

    for (const doc of hits) {
      const source = sourceById.get(doc.id);
      if (!source) {
        missingSource++;
        continue;
      }

      const existingLinks = await db.query.bookAuthors.findMany({
        where: eq(schema.bookAuthors.bookId, doc.id),
      });
      const linkedAuthorIds = new Set(existingLinks.map((l) => l.authorId));

      for (const name of doc.authors) {
        const authorId = await getOrCreateAuthorId(name, source);
        if (linkedAuthorIds.has(authorId)) continue;
        await db.insert(schema.bookAuthors).values({ bookId: doc.id, authorId }).onConflictDoNothing();
        linked++;
      }
    }

    scanned += hits.length;
    offset += PAGE_SIZE;
    if (scanned % 5000 === 0) logger.info({ scanned, linked }, 'progress');
    if (hits.length < PAGE_SIZE) break;
  }

  logger.info({ scanned, linked, missingSource }, 'book_authors backfill done');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.fatal({ err }, 'backfill failed');
    process.exit(1);
  });
