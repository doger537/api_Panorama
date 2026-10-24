import { describe, it, expect, beforeEach } from 'vitest';
import { clearSession, isSessionStale, loadSession, saveSession, sessionKey } from './session';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  } as Storage;
}

describe('capture session persistence', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it('round-trips an active capture session', () => {
    saveSession('map-1', { captureId: 'cap-1', mapId: 'map-1', title: 'Зал', x: 10, y: 20 }, storage);

    const restored = loadSession('map-1', storage);
    expect(restored).toMatchObject({ captureId: 'cap-1', mapId: 'map-1', title: 'Зал', x: 10, y: 20 });
    expect(restored?.savedAt).toBeTruthy();
  });

  it('keeps sessions per map', () => {
    saveSession('map-1', { captureId: 'cap-1', mapId: 'map-1', title: 'A', x: 0, y: 0 }, storage);
    saveSession('map-2', { captureId: 'cap-2', mapId: 'map-2', title: 'B', x: 1, y: 1 }, storage);

    expect(loadSession('map-1', storage)?.captureId).toBe('cap-1');
    expect(loadSession('map-2', storage)?.captureId).toBe('cap-2');
    expect(sessionKey('map-1')).not.toBe(sessionKey('map-2'));
  });

  it('ignores a session stored for another map', () => {
    saveSession('map-1', { captureId: 'cap-1', mapId: 'map-1', title: 'A', x: 0, y: 0 }, storage);
    storage.setItem(sessionKey('map-2'), JSON.stringify({ captureId: 'cap-1', mapId: 'map-1' }));

    expect(loadSession('map-2', storage)).toBeNull();
  });

  it('survives corrupted storage instead of throwing', () => {
    storage.setItem(sessionKey('map-1'), '{not json');
    expect(loadSession('map-1', storage)).toBeNull();
  });

  it('clears the session after success or cancel', () => {
    saveSession('map-1', { captureId: 'cap-1', mapId: 'map-1', title: 'A', x: 0, y: 0 }, storage);
    clearSession('map-1', storage);
    expect(loadSession('map-1', storage)).toBeNull();
  });

  it('works when storage is unavailable (private mode)', () => {
    expect(saveSession('map-1', { captureId: 'c', mapId: 'map-1', title: '', x: 0, y: 0 }, null as unknown as undefined)).toBeDefined();
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;
    expect(saveSession('map-1', { captureId: 'c', mapId: 'map-1', title: '', x: 0, y: 0 }, throwing)).toBe(false);
    expect(loadSession('map-1', throwing)).toBeNull();
    expect(() => clearSession('map-1', throwing)).not.toThrow();
  });

  it('flags stale sessions so an old capture is not resumed blindly', () => {
    const fresh = { captureId: 'c', mapId: 'map-1', title: '', x: 0, y: 0, savedAt: new Date().toISOString() };
    const old = { ...fresh, savedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString() };
    const broken = { ...fresh, savedAt: 'nonsense' };

    expect(isSessionStale(fresh)).toBe(false);
    expect(isSessionStale(old)).toBe(true);
    expect(isSessionStale(broken)).toBe(true);
  });
});
