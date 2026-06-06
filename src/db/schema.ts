import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ============================================================
// Книги
// ============================================================
export const books = pgTable(
  'books',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(), // 'openlibrary' | 'gutenberg' | 'archive' | 'user'
    sourceId: text('source_id').notNull(),
    isbn10: text('isbn_10'),
    isbn13: text('isbn_13'),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    language: text('language'), // ISO 639-1
    description: text('description'),
    publishYear: integer('publish_year'),
    publisher: text('publisher'),
    pageCount: integer('page_count'),
    coverUrl: text('cover_url'),
    hasFullText: boolean('has_full_text').notNull().default(false),
    downloadUrl: text('download_url'),
    formats: text('formats').array().notNull().default(sql`'{}'`),
    license: text('license'),
    popularity: real('popularity').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqSource: uniqueIndex('books_source_unique').on(t.source, t.sourceId),
    byIsbn13: index('books_isbn13_idx').on(t.isbn13),
    byLanguage: index('books_language_idx').on(t.language),
  }),
);

// ============================================================
// Авторы
// ============================================================
export const authors = pgTable(
  'authors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    birthYear: integer('birth_year'),
    deathYear: integer('death_year'),
    bio: text('bio'),
    source: text('source'),
    sourceId: text('source_id'),
  },
  (t) => ({
    uniqSource: uniqueIndex('authors_source_unique').on(t.source, t.sourceId),
    byName: index('authors_name_idx').on(t.name),
  }),
);

export const bookAuthors = pgTable(
  'book_authors',
  {
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => authors.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('author'), // 'author' | 'translator' | 'editor'
  },
  (t) => ({
    pk: primaryKey({ columns: [t.bookId, t.authorId, t.role] }),
  }),
);

// ============================================================
// Жанры / темы
// ============================================================
export const subjects = pgTable('subjects', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
});

export const bookSubjects = pgTable(
  'book_subjects',
  {
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    subjectId: integer('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.bookId, t.subjectId] }),
  }),
);

// ============================================================
// Пользователи (свой auth, минимум для MVP)
// ============================================================
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  displayName: text('display_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============================================================
// Личная библиотека
// ============================================================
export const userLibrary = pgTable(
  'user_library',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status').notNull().default('want_to_read'),
    rating: smallint('rating'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.bookId] }),
  }),
);

// ============================================================
// Прогресс чтения (синк между устройствами)
// ============================================================
export const readingProgress = pgTable(
  'reading_progress',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    cfi: text('cfi'),
    percent: real('percent'),
    deviceId: text('device_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.bookId] }),
  }),
);

// ============================================================
// Аннотации, закладки
// ============================================================
export const annotations = pgTable(
  'annotations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 'highlight' | 'note' | 'bookmark'
    cfi: text('cfi'),
    text: text('text'),
    note: text('note'),
    color: text('color'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUserBook: index('annotations_user_book_idx').on(t.userId, t.bookId),
    byUpdatedAt: index('annotations_updated_at_idx').on(t.updatedAt),
  }),
);
