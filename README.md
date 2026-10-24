# Panorama API / TTKMap

Локальная студия: загрузка 16 фотографий, Hugin/enblend stitching в отдельном worker, просмотр 360°, редактируемая 2D-карта, REST API.

Стек: React / TypeScript / Vite / Pannellum, Python 3.12 / FastAPI / SQLite.

## Запуск

Установите Python 3.12, Node.js 22.12+ и Hugin с enblend. Добавьте инструменты Hugin в PATH или передайте --hugin-bin.

```sh
python -m venv .venv
# Активируйте .venv
pip install -r backend/requirements.txt
npm --prefix frontend ci
npm --prefix frontend run build
python scripts/run_studio.py
```

Откройте http://127.0.0.1:8008/. Локальная студия открывается без формы входа и доступна только через loopback. Данные сохраняются в data/studio. Для серверного развёртывания используйте backend.app.main:app с обычной авторизацией.

## Возможности и ограничения

- 16 JPEG/PNG/WebP с перекрытием; порядок кадров можно менять, выбранный кадр можно удалить.
- API: CONTRACTS/openapi.yaml. Типы: CONTRACTS/types.ts.
- Панорама сохраняет измеренный вертикальный охват; один круг фотографий не обязательно покрывает пол и потолок.
- 2D генератор сейчас является эвристикой: оценивает прямоугольный контур видимой области по границам изображения. Это НЕ достоверная автоматическая реконструкция помещений; размеры, стены и проходы требуют проверки.
- Пользовательские фото, база, пароли, зависимости и Hugin binaries в репозиторий не включены. Фото для fixture integration tests нужно предоставить отдельно; их отсутствие не означает успешную проверку stitching.
- Сборка frontend и локальная склейка исходной серии проверены на Windows. Полная Docker/device acceptance не выполнена в этой рабочей сессии.

Дополнительная документация исходного проекта: docs/original-project-readme.md.
