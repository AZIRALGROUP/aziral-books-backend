/**
 * One-off backfill: reorder already-indexed Gutenberg author names from raw
 * MARC "Surname, Given" to natural "Given Surname" (see aggregators/authorName.ts).
 * Updates Postgres `authors` (name + sourceId, so future indexer runs match the
 * same row via onConflictDoNothing instead of creating a duplicate) and patches
 * the `authors` array on every affected Meili document.
 *
 * Run: pnpm tsx scripts/backfill-gutenberg-authors.ts
 */
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '../src/db/client.js';
import { normalizeGutenbergAuthorName } from '../src/aggregators/authorName.js';
import { logger } from '../src/logger.js';
import { booksIndex } from '../src/search/meili.js';

async function main(): Promise<void> {
  const gutenbergAuthors = await db.query.authors.findMany({
    where: eq(schema.authors.source, 'gutenberg'),
  });

  const renamedAuthorIds: string[] = [];
  for (const author of gutenbergAuthors) {
    const normalized = normalizeGutenbergAuthorName(author.name);
    if (normalized === author.name) continue;
    await db
      .update(schema.authors)
      .set({ name: normalized, sourceId: `gutenberg:${normalized}` })
      .where(eq(schema.authors.id, author.id));
    renamedAuthorIds.push(author.id);
  }
  logger.info({ renamed: renamedAuthorIds.length, total: gutenbergAuthors.length }, 'authors renamed in postgres');

  if (renamedAuthorIds.length === 0) {
    logger.info('nothing to sync to meili');
    return;
  }

  // Re-derive the full authors array per affected book (a book can have
  // multiple authors, only some of which may have been renamed) and push a
  // partial update to Meili — updateDocuments merges by primary key, it
  // does not replace the whole document.
  const links = await db.query.bookAuthors.findMany({
    where: inArray(schema.bookAuthors.authorId, renamedAuthorIds),
  });
  const affectedBookIds = [...new Set(links.map((l) => l.bookId))];

  let patched = 0;
  for (const bookId of affectedBookIds) {
    const bookLinks = await db.query.bookAuthors.findMany({
      where: eq(schema.bookAuthors.bookId, bookId),
    });
    const authorIds = bookLinks.map((l) => l.authorId);
    const bookAuthorRows = authorIds.length
      ? await db.query.authors.findMany({ where: inArray(schema.authors.id, authorIds) })
      : [];
    await booksIndex().updateDocuments([{ id: bookId, authors: bookAuthorRows.map((a) => a.name) }]);
    patched++;
  }
  logger.info({ patched }, 'meili documents patched');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.fatal({ err }, 'backfill failed');
    process.exit(1);
  });
