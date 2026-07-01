/**
 * One-off resync for already-indexed Wikisource books after the aggregator
 * picked up three fixes: author-stub/disambiguation noise filtering (critic
 * names and opera-libretto pages misattributed as an author's own works),
 * corrected literary-form classification for anything the noise filter now
 * excludes, and a non-zero popularity proxy (author canon order) so browse/
 * search ordering isn't flat.
 *
 * Re-running the indexer alone only inserts/updates — it never removes rows
 * for titles the aggregator no longer produces. This script re-fetches every
 * curated author, upserts the current correct set (same as the indexer), and
 * then deletes any of that author's existing books whose sourceId is no
 * longer in the fresh set (the noise now filtered out).
 *
 * Run: pnpm tsx scripts/resync-wikisource.ts
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { wikisourceAggregator } from '../src/aggregators/wikisource.js';
import { WIKISOURCE_AUTHORS } from '../src/aggregators/wikisource-authors.js';
import { indexInMeili, upsertBook } from '../src/workers/indexer.js';
import { logger } from '../src/logger.js';
import { ensureBooksIndex, booksIndex } from '../src/search/meili.js';

async function main(): Promise<void> {
  await ensureBooksIndex();

  let upserted = 0;
  let pruned = 0;

  for (let i = 0; i < WIKISOURCE_AUTHORS.length; i++) {
    const author = WIKISOURCE_AUTHORS[i]!;
    const page = i + 1;
    logger.info({ page, author: author.name }, 'resyncing author');

    let freshBooks;
    try {
      freshBooks = await wikisourceAggregator.fetchPage({ page });
    } catch (err) {
      logger.error({ err, author: author.name }, 'fetch failed — skipping author, leaving existing rows untouched');
      continue;
    }

    const validSourceIds = new Set(freshBooks.map((b) => b.sourceId));
    for (const book of freshBooks) {
      try {
        const id = await upsertBook(book);
        await indexInMeili(id, book);
        upserted++;
      } catch (err) {
        logger.error({ err, sourceId: book.sourceId }, 'failed to upsert book');
      }
    }

    // Find this author's existing DB rows and delete whichever ones aren't
    // in the fresh set anymore (now-filtered noise, or a page that vanished).
    const authorRow = await db.query.authors.findFirst({
      where: and(eq(schema.authors.source, 'wikisource'), eq(schema.authors.name, author.name)),
    });
    if (!authorRow) continue;

    const links = await db.query.bookAuthors.findMany({
      where: eq(schema.bookAuthors.authorId, authorRow.id),
    });
    if (links.length === 0) continue;

    const existingBooks = await db.query.books.findMany({
      where: inArray(
        schema.books.id,
        links.map((l) => l.bookId),
      ),
    });
    const staleIds = existingBooks.filter((b) => !validSourceIds.has(b.sourceId)).map((b) => b.id);
    if (staleIds.length === 0) continue;

    await db.delete(schema.books).where(inArray(schema.books.id, staleIds)); // cascades book_authors
    await booksIndex().deleteDocuments(staleIds);
    pruned += staleIds.length;
    logger.info({ author: author.name, pruned: staleIds.length }, 'pruned stale/noise books');

    // Polite pause between authors — same courtesy as the indexer's page loop.
    await new Promise((r) => setTimeout(r, 300));
  }

  logger.info({ upserted, pruned }, 'wikisource resync done');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.fatal({ err }, 'resync failed');
    process.exit(1);
  });
