/**
 * One-off backfill: reorder already-indexed Gutenberg author names from raw
 * MARC "Surname, Given" to natural "Given Surname" (see aggregators/authorName.ts).
 *
 * Two independent passes:
 *  1. Postgres `authors.name` (+ sourceId, so future indexer runs match the
 *     same row via onConflictDoNothing instead of creating a duplicate).
 *  2. A full scan of Meili documents, normalizing each doc's `authors` array
 *     in place. This does NOT go through the Postgres book_authors join —
 *     some already-indexed books only ever got their author name baked into
 *     the Meili document at ingest time with no corresponding book_authors
 *     link (a pre-existing data gap), so a join-based patch silently misses
 *     them. normalizeGutenbergAuthorName() is a safe no-op for any name that
 *     isn't in "Surname, Given" form (Wikisource's Cyrillic names, "Various",
 *     single names), so scanning every document regardless of source is safe.
 *
 * Run: pnpm tsx scripts/backfill-gutenberg-authors.ts
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { normalizeGutenbergAuthorName } from '../src/aggregators/authorName.js';
import { logger } from '../src/logger.js';
import { booksIndex, type BookSearchDoc } from '../src/search/meili.js';

async function backfillPostgres(): Promise<void> {
  const gutenbergAuthors = await db.query.authors.findMany({
    where: eq(schema.authors.source, 'gutenberg'),
  });
  let renamed = 0;
  for (const author of gutenbergAuthors) {
    const normalized = normalizeGutenbergAuthorName(author.name);
    if (normalized === author.name) continue;
    await db
      .update(schema.authors)
      .set({ name: normalized, sourceId: `gutenberg:${normalized}` })
      .where(eq(schema.authors.id, author.id));
    renamed++;
  }
  logger.info({ renamed, total: gutenbergAuthors.length }, 'authors renamed in postgres');
}

const PAGE_SIZE = 1000;

async function backfillMeili(): Promise<void> {
  const index = booksIndex();
  let offset = 0;
  let scanned = 0;
  let patched = 0;

  for (;;) {
    // getDocuments (not search) — a plain listing walk isn't subject to
    // Meili's maxTotalHits search-pagination cap (default 1000), which would
    // silently truncate an offset-based search() scan well before covering
    // the full ~15k-document index.
    const result = await index.getDocuments<BookSearchDoc>({ limit: PAGE_SIZE, offset });
    const hits = result.results;
    if (hits.length === 0) break;

    for (const doc of hits) {
      const normalizedAuthors = doc.authors.map((a) => normalizeGutenbergAuthorName(a));
      const changed = normalizedAuthors.some((a, i) => a !== doc.authors[i]);
      if (!changed) continue;
      await index.updateDocuments([{ id: doc.id, authors: normalizedAuthors }]);
      patched++;
    }

    scanned += hits.length;
    offset += PAGE_SIZE;
    if (hits.length < PAGE_SIZE) break;
  }
  logger.info({ scanned, patched }, 'meili documents scanned + patched');
}

async function main(): Promise<void> {
  await backfillPostgres();
  await backfillMeili();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.fatal({ err }, 'backfill failed');
    process.exit(1);
  });
