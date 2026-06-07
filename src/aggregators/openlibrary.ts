/**
 * Open Library Search API. Метаданные для миллионов книг,
 * полнотекстовые только частично (через Internet Archive).
 * https://openlibrary.org/dev/docs/api/search
 */
import { config } from '../config.js';
import { fetchWithRetry } from './fetch.js';
import type { AggregatedBook, Aggregator } from './types.js';

type OLSearchDoc = {
  key: string; // /works/OLxxx
  title: string;
  subtitle?: string;
  author_name?: string[];
  first_publish_year?: number;
  publisher?: string[];
  language?: string[];
  isbn?: string[];
  cover_i?: number;
  subject?: string[];
  ebook_access?: 'public' | 'borrowable' | 'printdisabled' | 'no_ebook';
  has_fulltext?: boolean;
  edition_count?: number;
};

type OLSearchResponse = { numFound: number; start: number; docs: OLSearchDoc[] };

export const openLibraryAggregator: Aggregator = {
  source: 'openlibrary',
  async fetchPage({ page }): Promise<AggregatedBook[]> {
    const url = new URL('/search.json', config.OPEN_LIBRARY_BASE);
    url.searchParams.set('q', '*');
    url.searchParams.set('page', String(page));
    url.searchParams.set('limit', '100');
    url.searchParams.set(
      'fields',
      'key,title,subtitle,author_name,first_publish_year,publisher,language,isbn,cover_i,subject,ebook_access,has_fulltext,edition_count',
    );
    const resp = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'AziralBooks/0.1 (+https://books.aziral.com)' },
    });
    if (!resp.ok) throw new Error(`openlibrary ${resp.status}`);
    const data = (await resp.json()) as OLSearchResponse;

    return data.docs.map((d) => {
      const isbn13 = (d.isbn ?? []).find((i) => i.length === 13) ?? null;
      const isbn10 = (d.isbn ?? []).find((i) => i.length === 10) ?? null;
      return {
        source: 'openlibrary' as const,
        sourceId: d.key.replace('/works/', ''),
        isbn13,
        isbn10,
        title: d.title,
        subtitle: d.subtitle ?? null,
        language: d.language?.[0] ?? null,
        publishYear: d.first_publish_year ?? null,
        publisher: d.publisher?.[0] ?? null,
        coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null,
        hasFullText: d.ebook_access === 'public' || d.has_fulltext === true,
        downloadUrl: null, // через Archive.org, разрешаем позже
        formats: d.ebook_access === 'public' ? ['epub'] : [],
        license: d.ebook_access === 'public' ? 'public_domain' : null,
        popularity: d.edition_count ?? 0,
        authors: d.author_name ?? [],
        subjects: (d.subject ?? []).slice(0, 20),
      };
    });
  },
};
