# TTKMap: план работ

> Генерируется из manifest.json: `python scripts/render_workplan.py`. Статусы исторических задач не заменяют приёмку кода.

## ttk-foundation: Общая основа TTKMap

- Статус: complete
- Зависимости: нет
- Область: `CONTRACTS/**`, `backend/app/config.py`, `backend/app/db.py`, `backend/app/errors.py`, `backend/app/schemas.py`, `backend/app/main.py`, `backend/app/auth.py`, `backend/app/cli.py`, `backend/app/routers/**`, `backend/app/modules/media/storage.py`, `backend/app/modules/README.md`, `backend/tests/conftest.py`, `backend/tests/test_core.py`, `backend/tests/test_contracts.py`, `frontend/package.json`, `frontend/tsconfig.json`, `frontend/vite.config.ts`, `frontend/index.html`, `frontend/scripts/**`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/shared/**`, `frontend/src/features/README.md`, `frontend/src/styles.css`, `compose.yaml`, `backend/Dockerfile`, `backend/worker/main.py`, `backend/worker/__init__.py`, `backend/worker/README.md`, `backend/requirements.txt`, `backend/pyproject.toml`, `scripts/check_contracts.py`, `.dockerignore`, `.env.example`, `.gitignore`, `AGENTS.md`, `README.md`, `CONTRACTS/AGENTS.md`, `TASKS/manifest.json`, `docs/demo.md`, `frontend/src/features/README.md`, `backend/app/modules/README.md`
- Проверка: `docker compose --profile test run --rm backend-test python scripts/check_contracts.py`

Созданы контракт OpenAPI/TypeScript/SQLite, FastAPI app и SQLite adapter, строгие модели, cookie auth, базовый CRUD карты с транзакционным сохранением, публичный снимок, Dijkstra, React/Vite shell, общие координатные helpers, Compose и проверки контракта. Это стартовая точка для feature-агентов, а не завершённый MVP. Готово: contract/schema/task-graph check проходит; новые модули подключаются независимо.

## ttk-backend-lock: Зафиксировать Python зависимости

- Статус: open
- Зависимости: ttk-foundation
- Область: `backend/Dockerfile`, `backend/requirements.lock`, `backend/requirements-lock-tool.txt`
- Проверка: `docker compose --profile test run --rm backend-test python -m pytest backend/tests -q`

Создать полный hash-pinned requirements.lock через зафиксированную версию pip-tools на Python 3.12, сохранить прямые зависимости из requirements.txt, добавить необходимые платформенные markers и переключить Dockerfile на установку только из lock-файла. Проверить чистую сборку backend image и backend tests на Linux amd64/arm64; lock не должен содержать локальные пути или секреты.

## ttk-frontend-lock: Создать воспроизводимый npm lock-файл

- Статус: open
- Зависимости: ttk-foundation
- Область: `frontend/package-lock.json`
- Проверка: `npm --prefix frontend run test`

Выполнить npm install для package.json на Node.js 22, создать package-lock.json lockfileVersion 3 и зафиксировать в нём дерево зависимостей. Проверить, что npm ci с нуля устанавливает проект на Linux/macOS/Windows и после установки проходит frontend unit tests. Не менять package.json или код приложения.

## ttk-auth-hardening: Закрыть auth и ownership тестами

- Статус: open
- Зависимости: ttk-backend-lock
- Область: `backend/app/auth.py`, `backend/app/routers/auth.py`, `backend/tests/auth/**`
- Проверка: `docker compose --profile test run --rm backend-test python -m pytest backend/tests/auth -q`

Укрепить login/session/logout: Argon2id, opaque cookie, CSRF и same-origin, отзыв/истечение сессий, rate limit пять неудач в минуту по IP/email, одинаковые ошибки учётных данных. Проверить owner на каждом вложенном ID и отсутствие утечек токена/пароля. Добавить тесты двух организаторов, анонимных запросов и чужого map. Готово: аноним получает 401, чужой объект 404, неверный Origin/CSRF 403, logout отзывает сессию.

## ttk-map-validation: Завершить доменную валидацию карты

- Статус: open
- Зависимости: ttk-auth-hardening
- Область: `backend/app/routers/maps.py`, `backend/app/schemas.py`, `backend/tests/maps/**`
- Проверка: `docker compose --profile test run --rm backend-test python -m pytest backend/tests/maps -q`

Дополнить базовый document handler проверкой map bounds, уникальных ID, геометрии стен/полигонов, принадлежности ссылок карте, типа фонового/панорамного asset, связи POI с узлами и publish gate. Сохранить порядок полного транзакционного replace, сильный If-Match, один прирост revision, неизменные slug/extent и rollback на любой ошибке. Добавить сценарии published save, конфликт редакторов, foreign references, невалидной геометрии и синхронизации POI-hotspot. Готово: неверный документ не меняет ни одну строку.

## ttk-stitch-fixtures: Подготовить реальные материалы съёмки

- Статус: open
- Зависимости: ttk-foundation
- Область: `backend/tests/fixtures/stitch/**`, `docs/capture_samples.md`
- Проверка: приёмка на устройствах

Подготовить три полные серии по 16 фотографий в одном пространстве из трёх точек, включая съёмку на iPhone и Android; добавить provenance, параметры, порядок кадров и границы покрытия в manifest. Добавить отдельную готовую 2:1 equirectangular панораму для прямого импорта и отрицательные входы с повторами/разрывом/несвязанными кадрами. Готово: реальные файлы доступны тестам, разрешения на использование зафиксированы; synthetic screenshots не выдаются за устройство-съёмку.

## ttk-media-api: Добавить API загрузки и защищённую выдачу медиа

- Статус: open
- Зависимости: ttk-auth-hardening
- Область: `backend/app/routers/media.py`, `backend/app/modules/media/**`, `backend/tests/media/**`
- Проверка: `docker compose --profile test run --rm backend-test python -m pytest backend/tests/media -q`

Реализовать upload/list asset, проверки JPEG/PNG/WebP по содержимому, лимиты и decompression-bomb защиту, EXIF rotation/GPS removal, оптимизированные варианты preview/mobile/full, атомарную запись и authorization-aware media endpoint. Проверять владельца или текущую published-ссылку до ответа 304; никогда не раздавать raw frames/unattached assets гостям. Создать unit/integration tests MIME spoofing, 413/415, изображения и revocation.

## ttk-capture-api: Добавить capture sessions и durable queue API

- Статус: open
- Зависимости: ttk-media-api
- Область: `backend/app/routers/captures.py`, `backend/app/modules/capture/**`, `backend/tests/capture/**`
- Проверка: `docker compose --profile test run --rm backend-test python -m pytest backend/tests/capture -q`

Реализовать create/list/get capture, идемпотентную загрузку слотов 0..15, start/retry/cancel и переходы в SQLite. Слоты принимают JPEG/PNG/WebP до лимита и запираются после stitch submit. Очередь должна переживать рестарт, максимум две попытки, отмена инвалидирует worker lease. Создать тесты повторной доставки, замены кадра, неполного набора, гонки submit/cancel, истечения и ownership.

## ttk-stitch-worker: Реализовать настоящий worker Hugin/enblend

- Статус: open
- Зависимости: ttk-capture-api, ttk-stitch-fixtures
- Область: `backend/worker/**`, `backend/tests/stitch/**`
- Проверка: `docker compose --profile test run --rm backend-test python -m pytest backend/tests/stitch -q`

Добавить отдельный процесс с durable SQLite claim/lease/heartbeat, Hugin pipeline pto_gen/cpfind/cpclean/autooptimiser/pano_modify/nona/enblend, timeout, cancellation и cleanup. Проверять замыкание горизонта на всех 16 кадрах, match inliers/RMS и реальную вертикальную alpha coverage; экспортировать spherical crop 4096 px без растяжения и создавать media variants. Только измеренное успешное покрытие создаёт Asset и succeeded; ошибки имеют contract error_code и retry ограничен. Добавить реальные fixture integration tests и responsiveness check API. Отсутствие Hugin/fixtures должно падать тестом.

## ttk-public-routing: Сделать public snapshot и полный panorama walk

- Статус: open
- Зависимости: ttk-map-validation
- Область: `backend/app/routers/public.py`, `backend/tests/routing/**`
- Проверка: `docker compose --profile test run --rm backend-test python -m pytest backend/tests/routing -q`

Усилить GET public map с publication-first ETag/no-cache и отдельным whitelist DTO. Маршрут строить серверным Dijkstra из опубликованного снимка с явными access nodes и стабильным tie-break. Собирать panorama walk только при панораме на каждом route node, directed transition на каждом шаге и edge <= max_walk_gap_units; иначе отдавать gaps и сохранять рабочий 2D route. Добавить tests развилок, disconnected graph, stale revision, unpublish, отсутствие owner/capture/raw-media в public JSON и walk gaps.

## ttk-frontend-core: Закрепить общий frontend API и session lifecycle

- Статус: open
- Зависимости: ttk-frontend-lock
- Область: `frontend/src/shared/**`, `frontend/src/app/**`
- Проверка: `npm --prefix frontend run test -- src/shared`

Завершить typed API client для auth/maps/assets/captures/public route, хранение CSRF только в памяти, ETag/If-Match, сохранение локальных изменений при 412 и обработку ApiError. Настроить accessible route shell и reusable geometry helpers. Добавить тесты API ошибок, 204/304, нестандартных размеров плана, восьми направлений и угла ±180. Не дублировать типы из CONTRACTS/types.ts.

## ttk-organizer-ui: Реализовать кабинет организатора

- Статус: open
- Зависимости: ttk-frontend-core, ttk-auth-hardening
- Область: `frontend/src/features/organizer/**`
- Проверка: `npm --prefix frontend run test -- src/features/organizer`

Сделать login/logout, список и создание карт, редакторский shell, состояние сохранения, конфликт версии 412 и publish/unpublish. Генерировать прямую стабильную ссылку и безопасный iframe snippet. Использовать общий API client, показывать причины publish gate, не оставлять операции записи в public UI. Component tests покрывают owner session, reload, retry/conflict и неизменность slug.

## ttk-plan-editor: Реализовать мобильный SVG редактор плана

- Статус: open
- Зависимости: ttk-frontend-core, ttk-media-api
- Область: `frontend/src/features/plan/**`
- Проверка: `npm --prefix frontend run test -- src/features/plan`

Сделать загрузку PNG/JPEG/WebP подложки, ручное рисование/перемещение стен, room/corridor polygons, все категории POI и пользовательскую категорию, graph nodes/edges и привязку POI к access node. Все операции сохраняют local plan units при zoom/pan и замене фона. Добавить тесты координатного преобразования, round-trip, удаления зависимостей и pointer/touch взаимодействий.

## ttk-panorama-ui: Реализовать viewer и редактор panorama hotspots

- Статус: open
- Зависимости: ttk-frontend-core, ttk-media-api
- Область: `frontend/src/features/panorama/**`
- Проверка: `npm --prefix frontend run test -- src/features/panorama`

Добавить Pannellum wrapper с lazy preview/mobile/full, ограниченным pitch и измеренными vaov/v_offset. Поддержать готовую сферу, позицию/heading на плане, ссылки POI и directed panorama transitions. Карточка хотспота использует текущие данные POI, а не копию текста. Создать тесты углов, входной ориентации, смены текста, ограниченного вертикального охвата, upload errors и удаления целей. Экспортировать viewer для public UI.

## ttk-capture-ui: Реализовать живой мобильный capture guide

- Статус: open
- Зависимости: ttk-frontend-core, ttk-capture-api, ttk-stitch-worker
- Область: `frontend/src/features/capture/**`
- Проверка: `npm --prefix frontend run test -- src/features/capture`

Сделать HTTPS getUserMedia видоискатель, 16 шагов с номинальным шагом 22.5 градусов, живой ghost overlay, просмотр и пересъёмку каждого кадра, optional DeviceOrientation с iOS permission внутри gesture. Загружать кадры последовательно с retry, восстанавливать сессию, показывать очередь/прогресс/cancel/failed и дать прямой upload готовой сферы отдельно. Тестировать отказ разрешений, отсутствие гироскопа, secure-context и сетевой retry; не показывать stitch success до API succeeded.

## ttk-visitor-ui: Реализовать visitor map, navigation и embed

- Статус: open
- Зависимости: ttk-frontend-core, ttk-public-routing, ttk-panorama-ui
- Область: `frontend/src/features/visitor/**`
- Проверка: `npm --prefix frontend run test -- src/features/visitor`

Сделать mobile-first /m/:slug и /embed/:slug, 2D план, фильтр/карточки POI, переключение панорам, выбор маршрута и визуализацию polyline. Реализовать route walkthrough по API шагам; gaps объясняют отсутствие прохода. Poll public snapshot каждые 15 секунд/при возврате вкладки, обновлять без смены URL и закрывать view на unpublish. Добавить тесты public-only доступа, route errors, live POI update, panorama walk/gaps, embed layout.

## ttk-integration: Подключить feature routers и собрать E2E

- Статус: open
- Зависимости: ttk-organizer-ui, ttk-plan-editor, ttk-panorama-ui, ttk-capture-ui, ttk-visitor-ui, ttk-stitch-worker
- Область: `.github/**`, `AGENTS.md`, `TASKS/WORKPLAN.md`, `TASKS/manifest.json`, `backend/app/main.py`, `frontend/index.html`, `frontend/src/App.tsx`, `frontend/src/styles.css`, `frontend/src/shared/**`, `frontend/src/features/**`, `compose.yaml`, `frontend/package.json`, `backend/tests/integration/**`, `frontend/e2e/**`, `scripts/e2e.mjs`, `scripts/seed_demo.py`, `README.md`, `docs/demo.md`
- Проверка: `npm --prefix frontend run test:e2e`

Подключить API routers и feature exports, включить реальный worker queue consumer в уже созданный Compose service, добавить production SPA serving, CSP маршрутов и безопасный embed. Создать изолированный seed через реальные API, Playwright cross-origin iframe и полный E2E сценарий: вход, импорт/рисование, POI, собственная серия stitching, hotspot, маршрут, live update <=20 секунд, 412 и unpublish/media revoke. Runner обязан использовать настоящий backend/SQLite/worker и ненулевой код при сбое; обновить README и demo runbook.

## ttk-device-acceptance: Проверить мобильный сценарий и релизные критерии

- Статус: open
- Зависимости: ttk-integration
- Область: `docs/acceptance.md`, `docs/measurements/**`
- Проверка: приёмка на устройствах

На HTTPS пройти сценарий на iOS Safari и Android Chrome: live capture overlay, реальные успешные серии, failed stitching UX, WebGL/pitch, touch targets, public map, external-origin embed без third-party cookies и fullscreen. Снять швы у трёх панорам, измерить preview/health/live и записать точные версии устройств, ОС и результаты Linux/macOS/Windows проверок. Готово: acceptance report содержит доказательства; загрузка готовой сферы не закрывает проверку stitching.

## ttk-audit-remediation: Закрыть замечания аудита и проверить полный MVP

- Статус: in_progress
- Зависимости: ttk-foundation, ttk-backend-lock, ttk-frontend-lock, ttk-auth-hardening, ttk-map-validation, ttk-stitch-fixtures, ttk-media-api, ttk-capture-api, ttk-stitch-worker, ttk-public-routing, ttk-frontend-core, ttk-organizer-ui, ttk-plan-editor, ttk-panorama-ui, ttk-capture-ui, ttk-visitor-ui, ttk-integration, ttk-device-acceptance
- Область: `backend/**`, `frontend/**`, `CONTRACTS/**`, `scripts/**`, `docs/**`, `.github/**`, `TASKS/**`, `AGENTS.md`, `README.md`, `compose.yaml`, `.dockerignore`, `.env.example`, `Audit.md`, `Improvements.md`
- Проверка: `npm --prefix frontend run test:e2e`

Авторизованное пользователем исправление A01–A20; общий код и wiring входят в задачу. Завершение после проверок и merge, device acceptance подтверждается отдельно.
