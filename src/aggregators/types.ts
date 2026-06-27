export type AggregatedBook = {
  source: 'openlibrary' | 'gutenberg' | 'archive' | 'wikisource';
  sourceId: string;
  isbn10?: string | null;
  isbn13?: string | null;
  title: string;
  subtitle?: string | null;
  language?: string | null;
  description?: string | null;
  publishYear?: number | null;
  publisher?: string | null;
  pageCount?: number | null;
  coverUrl?: string | null;
  hasFullText: boolean;
  downloadUrl?: string | null;
  formats: string[];
  license?: string | null;
  popularity?: number;
  authors: string[];
  subjects: string[];
};

export interface Aggregator {
  source: AggregatedBook['source'];
  fetchPage(opts: { page: number; modifiedSince?: Date }): Promise<AggregatedBook[]>;
}
