/**
 * Gutendex — JSON API над Project Gutenberg.
 * Полнотекстовые публичные книги, прямые ссылки на EPUB/HTML/TXT.
 * https://gutendex.com
 */
import { config } from '../config.js';
import { fetchWithRetry } from './fetch.js';
import type { AggregatedBook, Aggregator } from './types.js';

type GutendexBook = {
  id: number;
  title: string;
  authors: Array<{ name: string; birth_year: number | null; death_year: number | null }>;
  translators: Array<{ name: string }>;
  subjects: string[];
  bookshelves: string[];
  languages: string[];
  copyright: boolean | null;
  media_type: string;
  formats: Record<string, string>;
  download_count: number;
};

type GutendexPage = { count: number; next: string | null; previous: string | null; results: GutendexBook[] };

function pickFormats(fmts: Record<string, string>): { formats: string[]; downloadUrl: string | null } {
  const result: string[] = [];
  let primary: string | null = null;
  for (const [mime, url] of Object.entries(fmts)) {
    if (mime.includes('application/epub+zip') && !mime.includes('images')) {
      result.push('epub');
      primary = url;
    } else if (mime === 'application/pdf') {
      result.push('pdf');
      primary ??= url;
    } else if (mime.startsWith('text/html') && !mime.includes('images')) {
      result.push('html');
      primary ??= url;
    }
  }
  return { formats: result, downloadUrl: primary };
}

function coverUrlFor(b: GutendexBook): string | null {
  for (const [mime, url] of Object.entries(b.formats)) {
    if (mime.startsWith('image/')) return url;
  }
  return null;
}

export const gutendexAggregator: Aggregator = {
  source: 'gutenberg',
  async fetchPage({ page, modifiedSince }): Promise<AggregatedBook[]> {
    const url = new URL('/books', config.GUTENDEX_BASE);
    url.searchParams.set('page', String(page));
    if (modifiedSince) url.searchParams.set('mime_type', 'application/epub+zip');
    const resp = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'AziralBooks/0.1 (+https://books.aziral.com)' },
    });
    if (!resp.ok) throw new Error(`gutendex ${resp.status}`);
    const data = (await resp.json()) as GutendexPage;

    return data.results.map((b) => {
      const { formats, downloadUrl } = pickFormats(b.formats);
      return {
        source: 'gutenberg' as const,
        sourceId: String(b.id),
        title: b.title,
        language: b.languages[0] ?? null,
        publishYear: null,
        coverUrl: coverUrlFor(b),
        hasFullText: formats.length > 0,
        downloadUrl,
        formats,
        license: b.copyright === false ? 'public_domain' : b.copyright === true ? 'copyrighted' : null,
        popularity: b.download_count,
        authors: b.authors.map((a) => a.name),
        subjects: b.subjects,
      };
    });
  },
};
