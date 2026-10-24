import { useEffect, useState, type ReactNode } from "react";
import { Router } from "./app/Router";
import { LoginPage } from "./features/organizer/LoginPage";
import { MapList } from "./features/organizer/MapList";
import { OrganizerWorkspace } from "./features/organizer/OrganizerWorkspace";
import { PublicSpacePage } from "./features/visitor/PublicSpacePage";
import { apiClient, ApiClientError } from "./shared/api";
import { confirmNavigation, navigate } from "./shared/router";
import { Studio, StudioList } from './features/studio/Studio';

function OrganizerSession({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    void apiClient
      .session()
      .then(() => {
        if (!disposed) setState("ready");
      })
      .catch((e) => {
        if (disposed) return;
        if (e instanceof ApiClientError && e.status === 401) navigate("/login");
        else {
          setError("Не удалось проверить сессию. Обновите страницу.");
          setState("error");
        }
      });
    return () => {
      disposed = true;
    };
  }, []);
  if (state === "loading") return <p role="status">Проверяем сессию…</p>;
  if (state === "error") return <p role="alert">{error}</p>;
  return (
    <>
      {!compact && <header className="app-bar">
        <a href="/organize">ТТК · Мои карты</a>
        <button
          onClick={async () => {
            if (!confirmNavigation()) return;
            try {
              await apiClient.logout();
              navigate("/login", true);
            } catch {
              setError("Не удалось выйти. Повторите попытку.");
            }
          }}
        >
          Выйти
        </button>
        {error && <span role="alert">{error}</span>}
      </header>}
      {children}
    </>
  );
}

export function App() {
  return (
    <Router
      routes={[
        { pattern: '/studio', component: () => <OrganizerSession compact><StudioList /></OrganizerSession> },
        { pattern: '/studio/:mapId', component: route => <OrganizerSession compact><Studio key={route.params.mapId} mapId={route.params.mapId} /></OrganizerSession> },
        {
          pattern: "/",
          component: () => (
            <main className="workspace narrow">
              <h1>Карта пространства</h1>
              <p>
                Создайте план, добавьте панорамы и поделитесь маршрутом с
                посетителями.
              </p>
              <a className="button" href="/organize">
                Открыть кабинет
              </a>
              <p>Для просмотра карты откройте ссылку организатора.</p>
              <a className="button" href="/studio">Панорама и карта · загрузить 16 фото</a>
            </main>
          ),
        },
        { pattern: "/login", component: () => <LoginPage /> },
        {
          pattern: "/edit",
          component: () => (
            <OrganizerSession>
              <MapList />
            </OrganizerSession>
          ),
        },
        {
          pattern: "/organize",
          component: () => (
            <OrganizerSession>
              <MapList />
            </OrganizerSession>
          ),
        },
        {
          pattern: "/organize/:mapId",
          component: (route) => (
            <OrganizerSession>
              <OrganizerWorkspace
                key={route.params.mapId}
                mapId={route.params.mapId}
              />
            </OrganizerSession>
          ),
        },
        {
          pattern: "/m/:slug",
          component: (route) => (
            <PublicSpacePage key={route.params.slug} slug={route.params.slug} />
          ),
        },
        {
          pattern: "/embed/:slug",
          component: (route) => (
            <PublicSpacePage
              key={route.params.slug}
              slug={route.params.slug}
              mode="embed"
            />
          ),
        },
      ]}
    />
  );
}
export default App;
