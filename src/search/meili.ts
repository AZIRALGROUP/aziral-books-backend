import { MeiliSearch } from 'meilisearch';
import { config } from '../config.js';

export const meili = new MeiliSearch({
  host: config.MEILI_HOST,
  apiKey: config.MEILI_MASTER_KEY,
});

export const BOOKS_INDEX = 'books';

export type BookSearchDoc = {
  id: string;
  title: string;
  subtitle: string | null;
  authors: string[];
  isbn10: string | null;
  isbn13: string | null;
  description: string | null;
  language: string | null;
  publishYear: number | null;
  subjects: string[];
  hasFullText: boolean;
  license: string | null;
  formats: string[];
  coverUrl: string | null;
  popularity: number;
};

export async function ensureBooksIndex(): Promise<void> {
  const indexes = await meili.getIndexes();
  if (!indexes.results.some((i) => i.uid === BOOKS_INDEX)) {
    await meili.createIndex(BOOKS_INDEX, { primaryKey: 'id' });
  }
  const index = meili.index<BookSearchDoc>(BOOKS_INDEX);
  await index.updateSettings({
    searchableAttributes: ['title', 'subtitle', 'authors', 'isbn13', 'isbn10', 'description'],
    filterableAttributes: [
      'language',
      'publishYear',
      'subjects',
      'hasFullText',
      'license',
      'formats',
      'authors',
    ],
    sortableAttributes: ['publishYear', 'popularity'],
    rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness', 'popularity:desc'],
    // Return the highest-count facet values (e.g. authors with the most works),
    // not the default alphabetical slice that truncates before the big names.
    faceting: { maxValuesPerFacet: 200, sortFacetValuesBy: { '*': 'count' } },
    // Default cap is 1000, which silently truncates estimatedTotalHits/pagination
    // for broad queries once the corpus exceeds it.
    pagination: { maxTotalHits: 20000 },
  });
}

export function booksIndex() {
  return meili.index<BookSearchDoc>(BOOKS_INDEX);
}
