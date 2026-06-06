import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from './config.js';
import { logger } from './logger.js';
import { bookRoutes } from './routes/books.js';
import { opdsRoutes } from './routes/opds.js';
import { searchRoutes } from './routes/search.js';
import { ensureBooksIndex } from './search/meili.js';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, version: '0.1.0' }));

app.route('/api/v1/search', searchRoutes);
app.route('/api/v1/books', bookRoutes);
app.route('/api/v1/opds', opdsRoutes);

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  logger.error({ err }, 'unhandled error');
  return c.json({ error: 'internal_error' }, 500);
});

async function main() {
  try {
    await ensureBooksIndex();
  } catch (err) {
    logger.warn({ err }, 'meili init skipped — will retry on next request');
  }

  serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    logger.info(`Aziral Books backend listening on http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
