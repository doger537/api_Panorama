import { useEffect, useState } from 'react';
import { confirmNavigation, matchRoute, type RouteMatch } from '../shared/router';
import type React from 'react';

export interface Route {
  pattern: string;
  component: (match: RouteMatch) => React.ReactElement;
  title?: string;
}

export interface RouterProps {
  routes: Route[];
  fallback?: () => React.ReactElement;
}

export function Router({ routes, fallback }: RouterProps) {
  const [location, setLocation] = useState(() => window.location.pathname);

  useEffect(() => {
    if (typeof window.history.state?.ttkIndex !== 'number') {
      window.history.replaceState({ ...window.history.state, ttkIndex: 0 }, '');
    }
    let acceptedIndex = window.history.state.ttkIndex as number;
    let acceptedPath = window.location.pathname;
    let restoring = false;
    const accept = () => {
      acceptedIndex = window.history.state?.ttkIndex ?? 0;
      acceptedPath = window.location.pathname;
      setLocation(acceptedPath);
    };
    const handlePopState = () => {
      if (restoring) { restoring = false; return; }
      if (confirmNavigation()) { accept(); return; }
      const targetIndex = window.history.state?.ttkIndex;
      if (typeof targetIndex === 'number' && targetIndex !== acceptedIndex) {
        restoring = true;
        window.history.go(acceptedIndex - targetIndex);
      } else {
        window.history.pushState({ ttkIndex: acceptedIndex }, '', acceptedPath);
      }
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('ttk:navigate', accept);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('ttk:navigate', accept);
    };
  }, []);

  for (const route of routes) {
    const match = matchRoute(route.pattern, location);
    if (match) {
      if (route.title) {
        document.title = route.title;
      }
      return route.component(match);
    }
  }

  if (fallback) {
    return fallback();
  }

  return (
    <main role="main" style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>404 — Not Found</h1>
      <p>The requested page does not exist.</p>
      <a href="/">Return to home</a>
    </main>
  );
}
