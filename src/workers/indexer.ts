/**
 * Воркер индексации: тянет книги из агрегаторов,
 * upsert в Postgres, синкает в Meilisearch.
 *
 * Запуск:
 *   pnpm index:sync                  # одна итерация
 *   SOURCE=gutenberg PAGES=5 pnpm index:sync
 */
import { sql } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { logger } from '../logger.js';
import { booksIndex, ensureBooksIndex, type BookSearchDoc } from '../search/meili.js';
import { gutendexAggregator } from '../aggregators/gutendex.js';
import { openLibraryAggregator } from '../aggregators/openlibrary.js';
import type { AggregatedBook, Aggregator } from '../aggregators/types.js';

const AGGREGATORS: Record<string, Aggregator> = {
  gutenberg: gutendexAggregator,
  openlibrary: openLibraryAggregator,
};

async function upsertBook(b: AggregatedBook): Promise<string> {
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

  // Авторы
  for (const name of b.authors) {
    const [a] = await db
      .insert(schema.authors)
      .values({ name, source: b.source, sourceId: `${b.source}:${name}` })
      .onConflictDoNothing({ target: [schema.authors.source, schema.authors.sourceId] })
      .returning({ id: schema.authors.id });
    if (a) {
      await db
        .insert(schema.bookAuthors)
        .values({ bookId: row.id, authorId: a.id })
        .onConflictDoNothing();
    }
  }
  return row.id;
}

async function indexInMeili(bookId: string, b: AggregatedBook): Promise<void> {
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
    logger.error({ source: sourceArg }, 'unknown SOURCE — use gutenberg or openlibrary');
    process.exit(1);
  }

  let total = 0;
  for (let page = 1; page <= pages; page++) {
    logger.info({ source: sourceArg, page }, 'fetching page');
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
  }
  logger.info({ total }, 'indexing done');
  process.exit(0);
}

run().catch((err) => {
  logger.fatal({ err }, 'indexer crashed');
  process.exit(1);
});
