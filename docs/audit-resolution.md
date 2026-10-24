# Исправления аудита TTKMap

24 октября 2026. Ветка `task/ttk-audit-remediation`, исходная база `a9c4d8d`; замечания `Audit.md` относятся к `8a8d33e`. В начале работы в ветке уже был незакоммиченный набор исправлений. Он сохранён, проверен и дополнен; `photos/` и `Update Design/` не изменялись.

## Реализация A01–A20

| Аудит | Реализованный результат | Проверка |
|---|---|---|
| A01 | Video сохраняется при review, callback ref привязывает stream; encoder требует живой кадр и сохраняет пропорции | CaptureGuide/frame tests; браузерная серия из 16 фото с настоящим encoder |
| A02 | Terminal capture не используется повторно; pending File хранится до ack в IndexedDB; retry upload/submit/result; контекст карты remount; ID результата сохраняется для повторного импорта до следующей съёмки | Component lifecycle tests; E2E reload/retake и потери сети |
| A03 | Один Hugin pipeline; соседние/замыкающие соответствия; RMS/maximum reprojection residual; 4096×2048 alpha canvas, измеренный crop/vaov/offset | Реальные положительная/отрицательная серии; проверка соотношения размеров и углов |
| A04 | Heartbeat, deadline, unexpired lease при progress/commit/failure; остановка process group при cancel/timeout; очистка незакоммиченного результата | Worker lease, второй consumer, cancellation/timeout subprocess tests |
| A05 | Сохранённый AssetRef как единая подложка editor/picker/public; PNG/JPEG/WebP | Import→save→reload→public в E2E |
| A06 | Select/move/delete, произвольные стены/room/corridor, inspector POI/вершин, явные graph edges, undo/redo; inverse screen CTM | Editor/model tests и браузерное построение графа; физический touch отдельно |
| A07 | Capture получает документ/размеры; panorama position/node/heading; asset registry и directed transitions в workspace | Две панорамы, переход и `walk.available=true`, созданные через UI |
| A08 | Подтверждённый документ/ETag отделены от draft; 412 сохраняет правки; поздний save не затирает ввод; guard ухода; publish только после ответа | Slow-save/component tests, две вкладки E2E |
| A09 | Единственный server-session login; защищённые organizer URL; ошибки вместо fake success; один public flow; backlog controls удалены; auto-seed требует demo environment | Auth API/UI и product E2E |
| A10 | Node 22 build stage, dist и локальный CSS в образе; отдельный worker; HTTPS runbook, restart/resource policies | Docker build и E2E без Vite |
| A11 | `test:e2e` пересобирает образ и создаёт собственные API/SQLite/worker/credentials; Playwright Chromium; настоящая склейка | Полные команды ниже; рабочий volume не используется |
| A12 | Streaming size bound, multipart parse/Pillow/fs в thread pool, два одновременных upload, лимиты до decode; подготовка frame до writer transaction | Oversized stream и health во время блокированной обработки изображения |
| A13 | Строгий asset ID; normalize yaw после округления; async viewer error; stale viewer boot изолирован | Panorama tests и реальный Pannellum в E2E |
| A14 | HTML escaping iframe title; CSP разрешает frame-ancestors только `/embed/`; organizer защищён | Share tests и iframe с другого origin без organizer cookie |
| A15 | Простота полигона и cross-map ID validation, контролируемый integrity error; publish gate минимум POI; UI предупреждает о пустом плане/графе | API rollback/regression tests |
| A16 | Dummy Argon2 для неизвестного email; atomic limiter reservation и освобождение только успешной попытки; bounded memory; proxy/single-process policy | Unknown-user, rate/parallel reservations, ownership/CSRF/session tests |
| A17 | Обновлены npm/Python зависимости; hash lock согласован с requirements; npm ci и hash install в CI/Docker; SCA обоих стеков | npm audit, pip-audit, image build |
| A18 | Каноническая генерация DTO из OpenAPI, drift check; runtime response validation для auth/maps/media/capture/public/route/errors | Contract checker и integration tests |
| A19 | Pagination до старых карт, request/job logging, краткие ошибки, disk reserve; explicit backup/restore с SHA-256; retention/GC committed references; metadata commit до unlink | Backup/restore, corruption rejection, GC, upload tests; runbook |
| A20 | Актуальные URL, README и модульные инструкции; portable Node entrypoints; fixture hashes/provenance; generated workplan | Build/contracts/manifest checks; физические устройства и другие ОС отдельно |

Публикация разрешает карту с POI без графа: это явная совместимая политика, UI предупреждает об отсутствии навигации. Маршрут через стены автоматически не изобретается. GC требует остановленных API/worker, по умолчанию показывает план удаления; queued/running jobs блокируют обслуживание. Терминальные captures и неприкреплённые assets имеют настраиваемый retention (30 дней по умолчанию), collecting сохраняются. Лимит на число активных captures — два на карту; лимиты байтов/пикселей и дисковый резерв не заменяют мониторинг ёмкости установки.

## Проверки текущей версии

Ниже результаты завершённых команд. Полный backend-прогон и E2E выполнены на новой сборке образа, без монтирования рабочей БД.

- Frontend unit/component: 164 passed, 21 файл; финальная проверка после изменения capture recovery и viewer.
- Production frontend build: успешно на локальном Node 26 и Node 22 в Docker.
- npm audit: 0 известных уязвимостей.
- pip-audit полного hash-pinned requirements.lock: 0 известных уязвимостей.
- Полный backend `docker compose --profile test run --rm backend-test python -m pytest backend/tests -q`: **119 passed**, 146,37 с. Одна deprecation warning Starlette TestClient/httpx; runtime/контрактные тесты успешны.
- `docker compose --profile test build backend-test`: успешно; frontend собран Node 22, Python зависимости установлены с `--require-hashes`.
- `docker compose --profile test run --rm backend-test python scripts/check_contracts.py`: успешно внутри готового образа; OpenAPI, DTO drift, SQLite, manifest и WORKPLAN.
- Playwright capture: успешно — 16 настоящих фото через canvas MediaStream → JPEG encoder → API/SQLite → Hugin → измеренный asset → документ; reload/IndexedDB, retake и три сетевых отказа с восстановлением.
- Playwright product: **1 passed, 36,0 с** — login/new map/import/POI/graph/two panoramas/POI-hotspot/transition/publish/visitor route+viewer/cross-origin iframe/live update ≤20 с/412/unpublish/media 404. Ошибка 404 картинки в Pannellum также проверена.
- `npm --prefix frontend run test:e2e`: **2 passed, 2,4 минуты**, финальный прогон с cpfind в два потока. Включены duplicate→failed→retry (две попытки)→new→cancel→new; у failed capture отсутствует result asset. После изменения теста длительного lease отдельно прошли все **7 worker job tests**, 9,47 с.
- `git diff --check`: успешно.

Диагностический результат реальной серии: [stitch-2026-10-24.json](measurements/stitch-2026-10-24.json) — 4096×728, vaov 63,984375°, offset −2,900390625°, RMS 3,321 px. При воспроизведении точные числа могут меняться, тест проверяет границы качества. В браузерной цепочке (дополнительная JPEG-перекодировка) worker измерил RMS 3,329 px, 1578 соответствий; длительность одной задачи 88,49 с. Это не мобильный SLA.

## Ограничения приёмки

[acceptance.md](acceptance.md) содержит конкретные оставшиеся проверки iOS/Android по HTTPS, физической камеры и датчиков, touch, швов трёх серий, памяти/времени на устройствах. Доступна одна реальная положительная серия неизвестного устройства; браузерный canvas MediaStream не считается проверкой телефона. Windows/macOS/ARM64 отдельно не запускались. Backup-процедура протестирована на изолированной БД, рабочие данные не менялись.

Независимое review auth, данных, контрактов и worker по AGENTS.md ещё необходимо перед merge. Самопроверка и тесты не выдаются за независимое review. Пользователь разрешил push ветки и создание PR на GitHub без испытаний на физических устройствах; эти испытания не проводились. Статус задачи остаётся `in_progress` до merge.
