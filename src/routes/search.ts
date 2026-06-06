import { Hono } from 'hono';
import { z } from 'zod';
import { booksIndex } from '../search/meili.js';

export const searchRoutes = new Hono();

const searchQuery = z.object({
  q: z.string().default(''),
  lang: z.string().optional(),
  has_full_text: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  sort: z.enum(['popularity', 'year_asc', 'year_desc']).optional(),
});

searchRoutes.get('/', async (c) => {
  const parsed = searchQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!parsed.success) {
    return c.json({ error: 'invalid_query', details: parsed.error.flatten() }, 400);
  }
  const { q, lang, has_full_text, page, limit, sort } = parsed.data;

  const filters: string[] = [];
  if (lang) filters.push(`language = "${lang}"`);
  if (has_full_text !== undefined) filters.push(`hasFullText = ${has_full_text}`);

  const sortRule = sort === 'year_asc'
    ? ['publishYear:asc']
    : sort === 'year_desc'
      ? ['publishYear:desc']
      : sort === 'popularity'
        ? ['popularity:desc']
        : undefined;

  const result = await booksIndex().search(q, {
    offset: (page - 1) * limit,
    limit,
    filter: filters.length ? filters : undefined,
    sort: sortRule,
  });

  return c.json({
    success: true,
    data: result.hits,
    meta: {
      total: result.estimatedTotalHits,
      page,
      limit,
      query: q,
    },
  });
});
