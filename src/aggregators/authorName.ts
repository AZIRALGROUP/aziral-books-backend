/**
 * Gutendex (Project Gutenberg) returns author names in raw MARC
 * "Surname, Given Names" order, e.g. "Dostoyevsky, Fyodor" or
 * "Howard, Robert E. (Robert Ervin)". Reorder to natural "Given Surname"
 * for display, matching how Wikisource authors are already stored.
 */

const NAME_PARTICLE = /^(van|von|de|der|den|du|la|le)\s+[\p{L}'-]+$/iu;
const SIMPLE_SURNAME = /^[\p{Lu}][\p{L}'-]*$/u;

function looksLikeSurname(part: string): boolean {
  return SIMPLE_SURNAME.test(part) || NAME_PARTICLE.test(part);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeGutenbergAuthorName(raw: string): string {
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // No comma ("Various", "Plato", "Dante Alighieri") — already natural order.
  if (parts.length < 2) return raw;

  const [surname, ...rest] = parts;
  if (!surname || !looksLikeSurname(surname)) return raw;

  let given = rest.join(', ');

  // "Howard, Robert E. (Robert Ervin)" — prefer the spelled-out parenthetical.
  const parenMatch = given.match(/\(([^)]+)\)\s*$/);
  if (parenMatch?.[1]) {
    given = parenMatch[1].trim();
  }

  // "Byron, George Gordon Byron, Baron" — the given-name block already
  // contains the surname (plus a trailing title); don't re-append it.
  if (new RegExp(`\\b${escapeRegExp(surname)}\\b`, 'i').test(given)) {
    return given;
  }

  return `${given} ${surname}`.trim();
}
