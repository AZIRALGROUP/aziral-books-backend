# Supabase — Aziral Books

Хранилище auth/sync для веб- и нативных клиентов Readest-форка.

## Проект

- **Org:** AZIRAL
- **Project ref:** `tzjvgzutbtbiegzndmov`
- **URL:** https://tzjvgzutbtbiegzndmov.supabase.co
- **Region:** us-east-1 (North Virginia)
- **Compute:** nano (free tier)

## Миграции

Схема — порт из upstream Readest (`packages/readest/docker/volumes/db/`).
Файлы в этой папке нумерованы так, чтобы Supabase CLI разрешил их в
хронологическом порядке:

| File | Назначение |
|---|---|
| `00000000000000_init.sql` | первичная схема (books, book_files, ...) |
| `2026010100000100_…` … `2026010100001300_…` | upstream migrations 001…013 в порядке номеров |

### Применить (одноразово, на свежем проекте)

Через `psql`:

```bash
# DB password — из Project Settings → Database → "Database password"
# (если забыл — Reset DB password сгенерирует новый)
export PGPASSWORD='<db-password>'
psql "postgresql://postgres@db.tzjvgzutbtbiegzndmov.supabase.co:5432/postgres" \
  -v ON_ERROR_STOP=1 \
  -f supabase/migrations/00000000000000_init.sql

for f in supabase/migrations/2026*.sql; do
  echo "=== $f ==="
  psql "postgresql://postgres@db.tzjvgzutbtbiegzndmov.supabase.co:5432/postgres" \
    -v ON_ERROR_STOP=1 -f "$f"
done
unset PGPASSWORD
```

Через Supabase CLI (если установлен):

```bash
supabase link --project-ref tzjvgzutbtbiegzndmov
supabase db push
```

### NOT-idempotent

`00000000000000_init.sql` использует голый `CREATE TABLE` (без
`IF NOT EXISTS`). Повторный прогон на уже мигрированной БД упадёт —
это by design, чтобы случайно не перезаписать данные.

## RLS

Политики приходят вместе с миграциями (см. upstream). Проверь:
`Authentication → Policies` в дашборде после применения.
