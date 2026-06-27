/**
 * Wikisource aggregator — legal, full-text public-domain works.
 *
 * Everything on Wikisource is free content (public domain or CC), so unlike
 * scraping arbitrary "all books" sources this carries no copyright risk.
 *
 * Strategy:
 *  - We can't cleanly enumerate "books" from the main namespace (it's dominated
 *    by encyclopedia fragments — ЭСБЕ/Брокгауз etc.), so instead we walk a
 *    curated list of public-domain authors and read the works linked from each
 *    author page (namespace 0). That yields clean, real, famous titles.
 *  - Download is delegated to WSexport, which renders any wiki page into a
 *    proper EPUB on demand. We store that URL; the OPDS download endpoint
 *    302-redirects the reader to it.
 *
 * One `fetchPage({ page })` call processes ONE author (page = 1-based index into
 * the curated list), which fits the indexer's page loop:
 *   SOURCE=wikisource PAGES=40 pnpm index:sync
 */
import { config } from '../config.js';
import { fetchWithRetry } from './fetch.js';
import type { AggregatedBook, Aggregator } from './types.js';
import { WIKISOURCE_AUTHORS, type WikiAuthor } from './wikisource-authors.js';

const PL_LIMIT = 500; // MediaWiki max links per request
const CONTINUE_CAP = 6; // safety cap: ≤ 3000 links per author

// Encyclopedia/reference prefixes whose entries aren't standalone books.
const SKIP_PREFIXES = ['ЭСБЕ', 'МЭСБЕ', 'БЭЮ', 'ВЭ', 'ЕЭБЕ', 'НЭС', 'РБС', 'ЭСГ', 'БСЭ'];

interface MwLink {
  ns: number;
  title: string;
}

interface MwLinksResponse {
  query?: { pages?: Record<string, { title: string; links?: MwLink[]; missing?: string }> };
  continue?: { plcontinue?: string };
}

// "Война и мир (Толстой)" → "Война и мир". Strips a single trailing
// parenthetical (Wikisource's author/disambiguation suffix).
function cleanTitle(pageTitle: string): string {
  return pageTitle.replace(/\s*\([^()]*\)\s*$/, '').trim();
}

function isRealWork(title: string): boolean {
  if (title.includes('/')) return false; // subpages / encyclopedia paths
  if (title.includes(':')) return false; // namespace-prefixed (Автор:, Категория:…)
  const head = title.split('/')[0] ?? title;
  return !SKIP_PREFIXES.some((p) => head === p || title.startsWith(`${p} `));
}

function wsexportUrl(wsLang: string, pageTitle: string): string {
  const u = new URL(config.WSEXPORT_BASE);
  u.searchParams.set('lang', wsLang);
  u.searchParams.set('format', 'epub-3');
  u.searchParams.set('page', pageTitle);
  return u.toString();
}

async function fetchAuthorWorks(author: WikiAuthor): Promise<string[]> {
  const titles = new Set<string>();
  let plcontinue: string | undefined;

  for (let i = 0; i < CONTINUE_CAP; i++) {
    const url = new URL(`https://${author.host}/w/api.php`);
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('prop', 'links');
    url.searchParams.set('titles', author.page);
    url.searchParams.set('plnamespace', '0');
    url.searchParams.set('pllimit', String(PL_LIMIT));
    if (plcontinue) url.searchParams.set('plcontinue', plcontinue);

    const resp = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'AziralBooks/0.1 (+https://books.aziral.com)' },
    });
    if (!resp.ok) throw new Error(`wikisource ${resp.status}`);
    const data = (await resp.json()) as MwLinksResponse;

    const pages = Object.values(data.query?.pages ?? {});
    for (const p of pages) {
      if (p.missing !== undefined) return []; // author page doesn't exist
      for (const l of p.links ?? []) {
        if (isRealWork(l.title)) titles.add(l.title);
      }
    }

    plcontinue = data.continue?.plcontinue;
    if (!plcontinue) break;
  }

  return [...titles];
}

export const wikisourceAggregator: Aggregator = {
  source: 'wikisource',
  async fetchPage({ page }): Promise<AggregatedBook[]> {
    const author = WIKISOURCE_AUTHORS[page - 1];
    if (!author) return []; // past the end of the curated list — indexer stops

    const works = await fetchAuthorWorks(author);
    const subject = author.lang === 'kk' ? 'Қазақ әдебиеті' : 'Русская литература';

    return works.map((pageTitle) => ({
      source: 'wikisource' as const,
      sourceId: `${author.wsLang}:${pageTitle}`,
      title: cleanTitle(pageTitle),
      language: author.lang,
      hasFullText: true,
      downloadUrl: wsexportUrl(author.wsLang, pageTitle),
      formats: ['epub'],
      license: 'public_domain',
      popularity: 0,
      coverUrl: null,
      authors: [author.name],
      subjects: [subject],
    }));
  },
};
