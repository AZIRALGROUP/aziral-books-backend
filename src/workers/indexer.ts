/**
 * Воркер индексации: тянет книги из агрегаторов,
 * upsert в Postgres, синкает в Meilisearch.
 *
 * Запуск:
 *   pnpm index:sync                  # одна итерация
 *   SOURCE=gutenberg PAGES=5 pnpm index:sync
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { logger } from '../logger.js';
import { booksIndex, ensureBooksIndex, type BookSearchDoc } from '../search/meili.js';
import { gutendexAggregator } from '../aggregators/gutendex.js';
import { openLibraryAggregator } from '../aggregators/openlibrary.js';
import type { AggregatedBook, Aggregator } from '../aggregators/types.js';
import { wikisourceAggregator } from '../aggregators/wikisource.js';

const AGGREGATORS: Record<string, Aggregator> = {
  gutenberg: gutendexAggregator,
  openlibrary: openLibraryAggregator,
  wikisource: wikisourceAggregator,
};

export async function upsertBook(b: AggregatedBook): Promise<string> {
  const [row] = await db
    .insert(schema.books)
    .values({
      source: b.source,
      sourceId: b.sourceId,
      isbn10: b.isbn10 ?? null,
      isbn13: b.isbn13 ?? null,
      title: b.title,
      subtitle: b.subtitle ?? null,
      language: b.language ?? null,
      description: b.description ?? null,
      publishYear: b.publishYear ?? null,
      publisher: b.publisher ?? null,
      pageCount: b.pageCount ?? null,
      coverUrl: b.coverUrl ?? null,
      hasFullText: b.hasFullText,
      downloadUrl: b.downloadUrl ?? null,
      formats: b.formats,
      license: b.license ?? null,
      popularity: b.popularity ?? 0,
    })
    .onConflictDoUpdate({
      target: [schema.books.source, schema.books.sourceId],
      set: {
        title: b.title,
        subtitle: b.subtitle ?? null,
        coverUrl: b.coverUrl ?? null,
        hasFullText: b.hasFullText,
        downloadUrl: b.downloadUrl ?? null,
        formats: b.formats,
        popularity: b.popularity ?? 0,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: schema.books.id });
  if (!row) throw new Error('upsert returned no row');

  // Авторы. onConflictDoNothing().returning() only returns a row when the
  // insert actually happened — on a conflict (author already exists, the
  // common case after their first book) it returns nothing, so the id must
  // be looked up separately. Without this, book_authors only ever got linked
  // for whichever book introduced a new author, silently skipping the link
  // for every subsequent book by that same author.
  for (const name of b.authors) {
    const authorSourceId = `${b.source}:${name}`;
    const [inserted] = await db
      .insert(schema.authors)
      .values({ name, source: b.source, sourceId: authorSourceId })
      .onConflictDoNothing({ target: [schema.authors.source, schema.authors.sourceId] })
      .returning({ id: schema.authors.id });

    const authorId =
      inserted?.id ??
      (
        await db.query.authors.findFirst({
          where: and(eq(schema.authors.source, b.source), eq(schema.authors.sourceId, authorSourceId)),
        })
      )?.id;

    if (authorId) {
      await db
        .insert(schema.bookAuthors)
        .values({ bookId: row.id, authorId })
        .onConflictDoNothing();
    }
  }
  return row.id;
}

export async function indexInMeili(bookId: string, b: AggregatedBook): Promise<void> {
  const doc: BookSearchDoc = {
    id: bookId,
    title: b.title,
    subtitle: b.subtitle ?? null,
    authors: b.authors,
    isbn10: b.isbn10 ?? null,
    isbn13: b.isbn13 ?? null,
    description: b.description ?? null,
    language: b.language ?? null,
    publishYear: b.publishYear ?? null,
    subjects: b.subjects,
    hasFullText: b.hasFullText,
    license: b.license ?? null,
    formats: b.formats,
    coverUrl: b.coverUrl ?? null,
    popularity: b.popularity ?? 0,
  };
  await booksIndex().addDocuments([doc]);
}

async function run(): Promise<void> {
  await ensureBooksIndex();

  const sourceArg = process.env.SOURCE ?? 'gutenberg';
  const pages = Number(process.env.PAGES ?? '1');
  const aggregator = AGGREGATORS[sourceArg];
  if (!aggregator) {
    logger.error({ source: sourceArg }, 'unknown SOURCE — use gutenberg, openlibrary or wikisource');
    process.exit(1);
  }

  let total = 0;
  const startPage = Number(process.env.START_PAGE ?? '1');
  for (let page = startPage; page < startPage + pages; page++) {
    logger.info({ source: sourceArg, page }, 'fetching page');
    try {
      const books = await aggregator.fetchPage({ page });
      for (const book of books) {
        try {
          const id = await upsertBook(book);
          await indexInMeili(id, book);
          total++;
        } catch (err) {
          logger.error({ err, sourceId: book.sourceId }, 'failed to upsert book');
        }
      }
    } catch (err) {
      logger.error({ err, page }, 'page failed after retries — skipping');
    }
    // вежливая пауза перед следующей страницей
    if (page < startPage + pages - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  logger.info({ total }, 'indexing done');
  process.exit(0);
}

// Only auto-run when executed directly (`tsx src/workers/indexer.ts`), not
// when `upsertBook`/`indexInMeili` are imported for reuse by other scripts
// (e.g. scripts/resync-wikisource.ts).
if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((err) => {
    logger.fatal({ err }, 'indexer crashed');
    process.exit(1);
  });
}
