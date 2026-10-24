# Маршруты и состояние

`App.tsx` собирает маршруты: `/`, `/login`, `/organize`, `/organize/:mapId`, `/m/:slug`, `/embed/:slug`. `/edit` оставлен как вход в список карт после проверки сессии.

`OrganizerSession` проверяет реальную серверную сессию. Workspace владеет draft, saved revision, ETag и asset registry. `useWorkspace` обрабатывает 412 и изменения во время save. PlanEditor, CaptureGuide и PanoramaViewer не сохраняют собственную независимую копию карты.
