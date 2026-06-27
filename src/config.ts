import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url(),
  MEILI_HOST: z.string().url(),
  MEILI_MASTER_KEY: z.string().min(8),
  JWT_SECRET: z.string().min(16),
  OPEN_LIBRARY_BASE: z.string().url().default('https://openlibrary.org'),
  GUTENDEX_BASE: z.string().url().default('https://gutendex.com'),
  INTERNET_ARCHIVE_BASE: z.string().url().default('https://archive.org'),
  // Wikisource: legal full-text public-domain works. WSexport turns a wiki page
  // into a downloadable EPUB. Per-author source/lang lives in wikisource-authors.
  WSEXPORT_BASE: z.string().url().default('https://ws-export.wmcloud.org'),
  STORAGE_BACKEND: z.enum(['local', 'r2']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('/var/aziral-books/storage'),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

export const config: Config = envSchema.parse(process.env);
