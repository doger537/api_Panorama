/**
 * Remembers the capture session between page reloads.
 *
 * A phone reloads a tab aggressively (camera switches, low memory), and the
 * 16-frame series is uploaded one frame at a time. Without persistence the
 * organizer would lose the session id and every uploaded frame with it.
 */

export interface StoredCaptureSession {
  captureId: string;
  mapId: string;
  title: string;
  x: number;
  y: number;
  savedAt: string;
}

const PREFIX = 'ttkmap.capture.';

export function sessionKey(mapId: string): string {
  return `${PREFIX}${mapId}`;
}

function safeStorage(storage?: Storage | null): Storage | null {
  if (storage) return storage;
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Private mode / disabled cookies.
    return null;
  }
}

export function saveSession(mapId: string, session: Omit<StoredCaptureSession, 'savedAt'>, storage?: Storage | null): boolean {
  const target = safeStorage(storage);
  if (!target) return false;
  try {
    target.setItem(sessionKey(mapId), JSON.stringify({ ...session, savedAt: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}

export function loadSession(mapId: string, storage?: Storage | null): StoredCaptureSession | null {
  const target = safeStorage(storage);
  if (!target) return null;
  try {
    const raw = target.getItem(sessionKey(mapId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCaptureSession>;
    if (!parsed.captureId || parsed.mapId !== mapId) return null;
    return {
      captureId: parsed.captureId,
      mapId,
      title: parsed.title ?? 'Панорама 360°',
      x: Number(parsed.x) || 0,
      y: Number(parsed.y) || 0,
      savedAt: parsed.savedAt ?? '',
    };
  } catch {
    return null;
  }
}

export function clearSession(mapId: string, storage?: Storage | null): void {
  const target = safeStorage(storage);
  if (!target) return;
  try {
    target.removeItem(sessionKey(mapId));
  } catch {
    /* nothing else to do */
  }
}

/** True when the stored session is older than the retention window. */
export function isSessionStale(session: StoredCaptureSession, maxAgeMs = 6 * 60 * 60 * 1000): boolean {
  const saved = Date.parse(session.savedAt);
  if (Number.isNaN(saved)) return true;
  return Date.now() - saved > maxAgeMs;
}
