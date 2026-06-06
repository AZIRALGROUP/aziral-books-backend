# Aziral Books — Backend

OPDS-агрегатор и API. Тянет метаданные из Open Library, Gutendex, Internet Archive, складывает в PostgreSQL, индексирует в Meilisearch.

## Стек

- **Hono** — HTTP-сервер
- **Drizzle ORM** + PostgreSQL
- **Meilisearch** — полнотекстовый поиск
- **pino** — логи

## Локальный запуск

```bash
# 1. Запустить Postgres + Meilisearch
docker compose up -d

# 2. Скопировать env
cp .env.example .env

# 3. Установить зависимости
pnpm install

# 4. Применить миграции
pnpm db:push

# 5. Засеять каталог (одна страница Gutenberg = ~32 книги)
pnpm index:sync
# Или больше:
SOURCE=gutenberg PAGES=10 pnpm index:sync
SOURCE=openlibrary PAGES=5 pnpm index:sync

# 6. Поднять сервер
pnpm dev
```

## Эндпоинты

| Метод | Путь | Описание |
|---|---|---|
| GET | `/health` | проверка |
| GET | `/api/v1/search?q=...` | JSON поиск |
| GET | `/api/v1/books/:id` | детали книги |
| GET | `/api/v1/opds` | OPDS root feed (navigation) |
| GET | `/api/v1/opds/search?q=...` | OPDS поиск (acquisition) |
| GET | `/api/v1/opds/popular` | топ по популярности |
| GET | `/api/v1/opds/gutenberg` | только Gutenberg |

## Подключение клиента Aziral Books

В разделе **OPDS** клиента добавить каталог:

```
https://books.aziral.com/api/v1/opds
```

Локально для разработки:

```
http://localhost:8080/api/v1/opds
```

## Деплой на Hetzner

```bash
docker build -t aziral-books-backend .
# тегаем и пушим в registry, либо собираем на сервере
```

См. `../infra/` для production docker-compose и Nginx Proxy Manager конфигов.
