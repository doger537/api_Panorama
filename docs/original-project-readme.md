# TTKMap — Карта пространства

Сервис создания и просмотра одного плана пространства: геометрия, POI, граф маршрутов, панорамы, хотспоты, публичная ссылка и iframe. Съёмка состоит из 16 кадров; Hugin/enblend выполняется отдельным worker. Частичные сферы имеют измеренный вертикальный охват.

## Запуск

Поддерживаемое окружение: Docker Engine/Compose на Linux или Docker Desktop; Node 22.12+ для локальной разработки frontend. Python 3.12 используется в контейнере.

```sh
cp .env.example .env
```

Укажите `APP_ORIGIN` — **точный адрес, по которому открыт браузер**, без завершающего `/`. Для production установите HTTPS origin и `COOKIE_SECURE=true`.

Команды выполняются по отдельности из корня:

```sh
docker compose build
docker compose run --rm api python -m backend.app.cli init-db
docker compose run --rm api python -m backend.app.cli create-organizer --email organizer@example.test
docker compose up -d api worker
```

Откройте `http://127.0.0.1:8000` при локальной конфигурации. Frontend и стили включены в образ; Vite dev-server для поставки не требуется. Пароль вводится через CLI, предустановленной production-учётки нет.

Для телефона используйте HTTPS reverse proxy перед `127.0.0.1:8000`. Например, Caddy на хосте с правилом `maps.example.org { reverse_proxy 127.0.0.1:8000 }`. Настройте DNS и сертификат для собственного домена, поставьте соответствующий APP_ORIGIN и secure cookie. HTTP на LAN-IP не даёт доступа к камере. `/embed/:slug` разрешает внешние iframe, кабинет — запрещает.

Для rate limit по IP задайте `FORWARDED_ALLOW_IPS` в `.env`: только фактический IP доверенного reverse proxy, видимый из контейнера (для proxy на хосте это обычно gateway Compose-сети). Uvicorn доверяет `X-Forwarded-For` только от этих адресов. Без настройки посетители proxy делят один IP-лимит; не используйте `*` при доступе к API из недоверенной сети.

## Пользовательский сценарий

1. `/login`: вход организатора; `/organize`: создание/список карт.
2. Импорт PNG/JPEG/WebP или рисование стены, комнаты, коридора. Инструмент выбора перемещает объекты; inspector редактирует вершины и поля. Есть локальный undo/redo.
3. POI создаёт access node; проходы между узлами задаются явно. Граф должен следовать реальным проходам, стены не распознаются автоматически.
4. Выберите точку съёмки. Снимайте, проверяйте и подтверждайте 16 кадров. Неотправленный кадр сохраняется в IndexedDB, если браузер предоставляет хранилище. Ошибка загрузки/склейки имеет повтор/отмену; можно отдельно загрузить готовую 2:1 сферу.
5. Для панорам укажите узел маршрута и heading в inspector; добавьте POI-hotspots и направленные переходы между соседними панорамами. Сохраните документ.
6. Опубликуйте карту. Публичная ссылка `/m/:slug` и `/embed/:slug` стабильны; изменения становятся видны по polling в активной вкладке (интервал 15 с).
7. Посетитель выбирает точки маршрута; panorama walk доступен при панорамах и переходах на всём пути. При неполном покрытии остаётся рабочий 2D-маршрут с объяснением gaps.

Конфликт 412 оставляет локальные изменения в редакторе; их можно скачать и затем явно загрузить серверную версию. Старый документ не перезаписывается автоматически.

## Проверки

```sh
npm --prefix frontend ci
npm --prefix frontend run test
npm --prefix frontend run build
docker compose --profile test build backend-test
docker compose --profile test run --rm backend-test python -m pytest backend/tests -q
python3 scripts/check_contracts.py
frontend/node_modules/.bin/playwright install chromium
npm --prefix frontend run test:e2e
git diff --check
```

`test:e2e` строит актуальный образ, создаёт изолированный контейнер с собственной SQLite/медиа и случайным паролем, запускает Chromium и останавливает только свои ресурсы. Рабочий volume не затрагивается. Реальные fixtures Hugin проверяются `backend/tests/stitch`; проверка физического iOS/Android описывается отдельно и не подменяется Chromium/jsdom.

Одна установка из lock-файлов используется локально, в CI и Docker. После изменений OpenAPI выполните `python3 scripts/generate_types.py`, после manifest — `python3 scripts/render_workplan.py`; общий checker проверяет отсутствие drift. Для этих Python-скриптов нужен PyYAML из backend requirements.

## Данные и эксплуатация

SQLite использует FK/WAL/busy timeout; init не пересоздаёт существующую БД. Текущая schema version — 1. При изменении схемы требуется отдельная миграция с резервной копией; несовместимая версия завершает запуск ошибкой. API запускается одним процессом; in-memory auth limiter рассчитан на этот режим. Для нескольких API-процессов перед масштабированием нужен общий limiter. Worker можно масштабировать с общей БД: claim/heartbeat/commit проверяют lease.

Перед согласованным backup остановите запись и worker:

```sh
docker compose stop api worker
docker compose run --rm api python -m backend.app.cli backup /data/backups/backup-2026-10-24
```

Backup содержит SQLite snapshot, все связанные медиа и SHA-256 каждого файла. Restore проверяет целостность SQLite, FK и хеши до создания каталога. Проверяйте восстановление в **новый каталог**, не поверх существующих данных:

```sh
docker compose run --rm api python -m backend.app.cli restore /data/backups/backup-2026-10-24 /data/restored-check
```

После проверки можно переключить `DATABASE_PATH=/data/restored-check/database.sqlite`, `MEDIA_PATH=/data/restored-check/media` и запустить сервисы. Сохраните прежний каталог для отката. Не копируйте один `.sqlite` из работающего WAL-режима вручную.

GC по умолчанию показывает файлы старше 24 часов, которые будут сиротами после применения retention, без изменения БД/файлов. Сначала завершите/отмените queued jobs и остановите API/worker. Затем:

```sh
docker compose run --rm api python -m backend.app.cli gc
docker compose run --rm api python -m backend.app.cli gc --apply --services-stopped
```

Файлы, прикреплённые к картам, не удаляются. При --apply удаляются terminal captures и неприкреплённые assets старше 30 дней (настраивается --retention-days); затем очищаются сироты и истёкшие sessions. Старые незавершённые collecting сессии не удаляются автоматически. Логи worker содержат capture ID, этап, код ошибки и длительность; API добавляет request ID. Секреты и изображения не логируются. Следите за свободным диском, временем jobs и очередью. Worker ограничен 2 CPU/3 GiB в Compose; уточняйте лимиты по размеру входных кадров.

## Документация

- `specification.md`, `docs/reference_raw.md` — ТЗ и MVP; offline/этажи/аналитика/AI/полная 3D-реконструкция остаются backlog.
- `Audit.md` — исходные находки на старом коммите, `docs/audit-resolution.md` — проверяемый результат исправлений.
- `AGENTS.md`, `CONTRACTS/AGENTS.md` — краткие правила и инварианты.
- `TASKS/manifest.json` — единственный источник назначения задач; WORKPLAN генерируется.
