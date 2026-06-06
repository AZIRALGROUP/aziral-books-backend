/**
 * OPDS 1.2 каталог (Atom XML).
 * Клиент readest/Aziral Books уже умеет читать этот формат —
 * никакой кастомной интеграции на клиенте не требуется.
 *
 * Спека: https://specs.opds.io/opds-1.2
 */
import { Hono } from 'hono';
import { booksIndex } from '../search/meili.js';

export const opdsRoutes = new Hono();

const BASE = '/api/v1/opds';

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function rootFeed(): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>https://books.aziral.com${BASE}</id>
  <title>Aziral Books</title>
  <subtitle>Aggregated catalog from Open Library, Project Gutenberg, Internet Archive</subtitle>
  <updated>${now}</updated>
  <author><name>Aziral</name><uri>https://books.aziral.com</uri></author>
  <link rel="self" href="${BASE}" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <link rel="start" href="${BASE}" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <link rel="search"
        type="application/opensearchdescription+xml"
        href="${BASE}/search.xml"/>

  <entry>
    <id>${BASE}/popular</id>
    <title>Popular</title>
    <updated>${now}</updated>
    <content type="text">Most popular books across all sources</content>
    <link rel="subsection" href="${BASE}/popular"
          type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  </entry>

  <entry>
    <id>${BASE}/recent</id>
    <title>Recently added</title>
    <updated>${now}</updated>
    <content type="text">Latest additions to the catalog</content>
    <link rel="subsection" href="${BASE}/recent"
          type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  </entry>

  <entry>
    <id>${BASE}/gutenberg</id>
    <title>Project Gutenberg</title>
    <updated>${now}</updated>
    <content type="text">Free public-domain books from Project Gutenberg</content>
    <link rel="subsection" href="${BASE}/gutenberg"
          type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  </entry>
</feed>`;
}

function acquisitionFeed(
  title: string,
  selfPath: string,
  hits: Array<{
    id: string;
    title: string;
    authors?: string[];
    description?: string | null;
    publishYear?: number | null;
    formats?: string[];
    coverUrl?: string | null;
  }>,
): string {
  const now = new Date().toISOString();
  const entries = hits
    .map((b) => {
      const authors = (b.authors ?? []).map((a) => `<author><name>${xmlEscape(a)}</name></author>`).join('');
      const cover = b.coverUrl
        ? `<link rel="http://opds-spec.org/image" href="${xmlEscape(b.coverUrl)}" type="image/jpeg"/>
           <link rel="http://opds-spec.org/image/thumbnail" href="${xmlEscape(b.coverUrl)}" type="image/jpeg"/>`
        : '';
      const acquisitions = (b.formats ?? ['epub'])
        .map((fmt) => {
          const mime = fmt === 'epub'
            ? 'application/epub+zip'
            : fmt === 'pdf'
              ? 'application/pdf'
              : fmt === 'fb2'
                ? 'application/x-fictionbook+xml'
                : 'application/octet-stream';
          return `<link rel="http://opds-spec.org/acquisition" type="${mime}" href="${BASE}/books/${b.id}/download?format=${fmt}"/>`;
        })
        .join('');
      return `<entry>
  <id>urn:aziral-books:${b.id}</id>
  <title>${xmlEscape(b.title)}</title>
  ${authors}
  <updated>${now}</updated>
  ${b.description ? `<summary type="text">${xmlEscape(b.description.slice(0, 1000))}</summary>` : ''}
  ${cover}
  ${acquisitions}
</entry>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>https://books.aziral.com${BASE}${selfPath}</id>
  <title>${xmlEscape(title)}</title>
  <updated>${now}</updated>
  <link rel="self" href="${BASE}${selfPath}" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  <link rel="start" href="${BASE}" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  ${entries}
</feed>`;
}

opdsRoutes.get('/', (c) => {
  return c.body(rootFeed(), 200, {
    'Content-Type': 'application/atom+xml;profile=opds-catalog;kind=navigation;charset=utf-8',
  });
});

opdsRoutes.get('/search.xml', (c) => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Aziral Books</ShortName>
  <Description>Search across the aggregated catalog</Description>
  <Url type="application/atom+xml;profile=opds-catalog;kind=acquisition"
       template="${BASE}/search?q={searchTerms}"/>
</OpenSearchDescription>`;
  return c.body(xml, 200, { 'Content-Type': 'application/opensearchdescription+xml;charset=utf-8' });
});

opdsRoutes.get('/search', async (c) => {
  const q = c.req.query('q') ?? '';
  const result = await booksIndex().search(q, { limit: 50 });
  const xml = acquisitionFeed(`Search: ${q}`, `/search?q=${encodeURIComponent(q)}`, result.hits);
  return c.body(xml, 200, {
    'Content-Type': 'application/atom+xml;profile=opds-catalog;kind=acquisition;charset=utf-8',
  });
});

opdsRoutes.get('/popular', async (c) => {
  const result = await booksIndex().search('', {
    limit: 50,
    sort: ['popularity:desc'],
  });
  return c.body(acquisitionFeed('Popular', '/popular', result.hits), 200, {
    'Content-Type': 'application/atom+xml;profile=opds-catalog;kind=acquisition;charset=utf-8',
  });
});

opdsRoutes.get('/recent', async (c) => {
  const result = await booksIndex().search('', { limit: 50 });
  return c.body(acquisitionFeed('Recent', '/recent', result.hits), 200, {
    'Content-Type': 'application/atom+xml;profile=opds-catalog;kind=acquisition;charset=utf-8',
  });
});

opdsRoutes.get('/gutenberg', async (c) => {
  const result = await booksIndex().search('', {
    limit: 50,
    filter: ['hasFullText = true'],
  });
  return c.body(acquisitionFeed('Project Gutenberg', '/gutenberg', result.hits), 200, {
    'Content-Type': 'application/atom+xml;profile=opds-catalog;kind=acquisition;charset=utf-8',
  });
});
