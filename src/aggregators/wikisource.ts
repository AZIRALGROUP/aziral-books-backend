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

// Coarse literary form for the catalogue's section filter. Poetry and drama are
// detected from a work's Wikisource categories (reliable for the bulk of poems
// and plays); everything else — novels, stories, essays — defaults to prose,
// which is correct for the major multi-part works whose index page carries no
// form category (Анна Каренина, Преступление и наказание, …).
export type WorkForm = 'Поэзия' | 'Проза' | 'Драматургия';

function deriveForm(categories: string[], title: string): WorkForm {
  const c = categories.join(' ').toLowerCase();
  const t = title.toLowerCase();
  if (/поэзия|стихотвор|стихи|поэма|сонет/.test(c) || /\((поэма|стихотворени)/.test(t)) {
    return 'Поэзия';
  }
  if (/пьес|драматург|комеди|трагеди|драмы/.test(c) || /\((пьеса|комеди|траге|драма|водевиль)/.test(t)) {
    return 'Драматургия';
  }
  return 'Проза';
}

const CAT_BATCH = 50; // MediaWiki max titles per query
const AUTHOR_NAMESPACE = 102; // ru.wikisource "Автор:" namespace

// Wikisource carries bare-name stub/disambiguation pages for people (e.g. a
// critic mentioned in an author's bio) whose only real content is a
// cross-reference link to their own "Автор:" page. Those stubs get pulled in
// by the author bio's outbound links same as real works, so they need a
// dedicated signal to exclude — title shape alone can't tell "Джон Теннер"
// (a real Pushkin essay) apart from "Владимир Спасович" (a critic's name,
// not Pushkin's work).
//
// IMPORTANT: a genuine work page routinely links to its OWN author's "Автор:"
// page too — richly-templated pages (e.g. "Анна Каренина (Толстой)") do this
// via their header template. So the signal isn't "any ns102 link" (that
// false-positived on exactly the best-curated major novels), it's "links to
// an Автор: page OTHER than the one we're currently walking" — a person-stub
// links to ITS OWN canonical page, never the current author's.
const DISAMBIG_CATEGORY = 'Категория:Многозначные термины';

interface WorkMeta {
  forms: Map<string, WorkForm>;
  noise: Set<string>; // author-stub / disambiguation pages misattributed as works
}

// Fetch each work's categories + outbound "Автор:" links (batched) to derive
// its literary form and flag non-work noise (author stubs, disambig pages).
async function fetchWorkMeta(host: string, authorPage: string, titles: string[]): Promise<WorkMeta> {
  const forms = new Map<string, WorkForm>();
  const noise = new Set<string>();
  for (let i = 0; i < titles.length; i += CAT_BATCH) {
    const batch = titles.slice(i, i + CAT_BATCH);
    const body = new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'categories|links',
      cllimit: '500',
      clshow: '!hidden',
      plnamespace: String(AUTHOR_NAMESPACE),
      pllimit: '500',
      titles: batch.join('|'),
    });
    const resp = await fetchWithRetry(`https://${host}/w/api.php`, {
      method: 'POST',
      headers: {
        'User-Agent': 'AziralBooks/0.1 (+https://books.aziral.com)',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!resp.ok) continue; // best-effort: missing metadata just defaults to prose, kept
    const data = (await resp.json()) as {
      query?: {
        pages?: Record<
          string,
          { title: string; categories?: Array<{ title: string }>; links?: MwLink[] }
        >;
      };
    };
    for (const p of Object.values(data.query?.pages ?? {})) {
      const cats = (p.categories ?? []).map((cat) => cat.title);
      forms.set(p.title, deriveForm(cats, p.title));
      const linksToOtherAuthor = (p.links ?? []).some((l) => l.title !== authorPage);
      const isDisambig = cats.includes(DISAMBIG_CATEGORY);
      if (linksToOtherAuthor || isDisambig) noise.add(p.title);
    }
  }
  return { forms, noise };
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

    const allWorks = await fetchAuthorWorks(author);

    // Russian works get a literary-form section (Проза/Поэзия/Драматургия) plus
    // author-stub/disambiguation filtering from their categories + outbound
    // links; Kazakh works (mostly Abai's poems) keep a single tag and skip the
    // ns102 signal (no "Автор:" namespace convention on the multilingual wiki).
    const { forms, noise } =
      author.lang === 'kk'
        ? { forms: new Map<string, WorkForm>(), noise: new Set<string>() }
        : await fetchWorkMeta(author.host, author.page, allWorks);
    const works = allWorks.filter((title) => !noise.has(title));

    // Wikisource has no download-count analog, so every book got popularity 0
    // and browse/search ordering across authors was arbitrary insertion order.
    // WIKISOURCE_AUTHORS is curated in canon order (Пушкин, Толстой,
    // Достоевский, … down to lesser-known names), so use the author's list
    // position as a coarse, author-level popularity proxy — it doesn't rank
    // one work over another by the SAME author, but it surfaces major authors'
    // books above obscure ones when a shelf pools many authors together.
    const popularity = WIKISOURCE_AUTHORS.length - (page - 1);

    return works.map((pageTitle) => ({
      source: 'wikisource' as const,
      sourceId: `${author.wsLang}:${pageTitle}`,
      title: cleanTitle(pageTitle),
      language: author.lang,
      hasFullText: true,
      downloadUrl: wsexportUrl(author.wsLang, pageTitle),
      formats: ['epub'],
      license: 'public_domain',
      popularity,
      coverUrl: null,
      authors: [author.name],
      subjects: author.lang === 'kk' ? ['Қазақ әдебиеті'] : [forms.get(pageTitle) ?? 'Проза'],
    }));
  },
};
