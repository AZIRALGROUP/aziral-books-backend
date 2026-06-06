import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, schema } from '../db/client.js';

export const bookRoutes = new Hono();

bookRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await db.query.books.findFirst({ where: eq(schema.books.id, id) });
  if (!row) return c.json({ error: 'not_found' }, 404);

  // Авторы и темы — отдельными запросами
  const links = await db.query.bookAuthors.findMany({ where: eq(schema.bookAuthors.bookId, id) });
  const authorIds = links.map((l) => l.authorId);
  const authors = authorIds.length
    ? await db.query.authors.findMany({
        where: (a, { inArray }) => inArray(a.id, authorIds),
      })
    : [];

  return c.json({
    success: true,
    data: {
      ...row,
      authors: authors.map((a) => ({ id: a.id, name: a.name })),
    },
  });
});
