# systemd units — Aziral Books

Ежедневный одноразовый запуск индексера каталога.

## Установка

```bash
sudo cp aziral-books-indexer.service /etc/systemd/system/
sudo cp aziral-books-indexer.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now aziral-books-indexer.timer
```

## Проверка

```bash
systemctl list-timers aziral-books-indexer.timer
journalctl -u aziral-books-indexer.service --since today
tail -f /var/log/aziral-books-indexer.log
```

## Ручной запуск

```bash
sudo systemctl start aziral-books-indexer.service
# или с параметрами:
SOURCE=openlibrary PAGES=10 START_PAGE=1 \
  /var/www/aziral-books/backend/scripts/run-indexer.sh
```

## Расписание

`OnCalendar=*-*-* 03:30:00` + `RandomizedDelaySec=15min` — каждый день
между 03:30 и 03:45 локального времени сервера.
`Persistent=true` — если сервер был выключен, таймер выстрелит при старте.
