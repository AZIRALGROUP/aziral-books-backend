/**
 * Обёртка над fetch с retry+backoff для внешних API.
 * 503/429/5xx → ждём и повторяем с экспоненциальным backoff.
 */
import { logger } from '../logger.js';

export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(
  url: string | URL,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<Response> {
  const max = opts.maxAttempts ?? 5;
  const base = opts.baseDelayMs ?? 1000;
  const cap = opts.maxDelayMs ?? 30_000;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      const resp = await fetch(url, init);
      if (resp.ok) return resp;

      const retriable = resp.status === 429 || (resp.status >= 500 && resp.status < 600);
      if (!retriable || attempt === max) {
        return resp;
      }
      const retryAfter = Number(resp.headers.get('retry-after')) * 1000;
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter, cap)
        : Math.min(base * 2 ** (attempt - 1), cap);
      logger.warn({ url: String(url), status: resp.status, attempt, delayMs: delay }, 'retrying');
      await sleep(delay);
    } catch (err) {
      lastErr = err;
      if (attempt === max) throw err;
      const delay = Math.min(base * 2 ** (attempt - 1), cap);
      logger.warn({ url: String(url), err: String(err), attempt, delayMs: delay }, 'retrying after error');
      await sleep(delay);
    }
  }
  throw lastErr ?? new Error('fetchWithRetry exhausted');
}
