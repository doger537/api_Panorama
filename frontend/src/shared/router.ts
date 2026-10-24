export type RouteParams = Record<string, string>;

export interface RouteMatch {
  path: string;
  params: RouteParams;
}

export function matchRoute(pattern: string, path: string): RouteMatch | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);

  if (patternParts.length !== pathParts.length) {
    return null;
  }

  const params: RouteParams = {};

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];

    if (patternPart.startsWith(':')) {
      params[patternPart.slice(1)] = pathPart;
    } else if (patternPart !== pathPart) {
      return null;
    }
  }

  return { path: pattern, params };
}

let navigationGuard: (() => boolean) | null = null;

export function guardNavigation(guard: () => boolean): () => void {
  navigationGuard = guard;
  return () => { if (navigationGuard === guard) navigationGuard = null; };
}

export function confirmNavigation(): boolean {
  return navigationGuard?.() ?? true;
}

export function navigate(path: string, confirmed = false): void {
  if (!confirmed && !confirmNavigation()) return;
  window.history.pushState({ ttkIndex: (window.history.state?.ttkIndex ?? 0) + 1 }, '', path);
  window.dispatchEvent(new Event('ttk:navigate'));
}
