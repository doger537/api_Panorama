import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicMap } from '../../../../CONTRACTS/types';
import { ApiClientError, apiClient } from '../../shared/api';
import { buildVisitorModel, type VisitorModel } from './model';

export type PublicMapStatus = 'loading' | 'ready' | 'not-found' | 'error';

export interface PublicMapState {
  status: PublicMapStatus;
  snapshot: PublicMap | null;
  model: VisitorModel | null;
  error: string | null;
  revision: number | null;
  /** Incremented every time a newer revision arrives through live polling. */
  liveUpdates: number;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export interface UsePublicMapOptions {
  live?: boolean;
  pollMs?: number;
}

/**
 * Loads a published map by slug and keeps it fresh.
 *
 * Uses `If-None-Match` so a steady poll costs a 304 with no body; on a new
 * revision the snapshot is replaced in place, which is what "live update
 * without changing the public link" requires.
 */
export function usePublicMap(slug: string, options: UsePublicMapOptions = {}): PublicMapState {
  const { live = true, pollMs = 15000 } = options;
  const [state, setState] = useState<{
    status: PublicMapStatus;
    snapshot: PublicMap | null;
    error: string | null;
    liveUpdates: number;
  }>({ status: 'loading', snapshot: null, error: null, liveUpdates: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const etagRef = useRef<string | null>(null);
  const snapshotRef = useRef<PublicMap | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const load = useCallback(
    async (force = false) => {
      if (!slug || inFlightRef.current) return;
      inFlightRef.current = true;
      if (force || !snapshotRef.current) setRefreshing(true);
      try {
        const result = await apiClient.getPublicMap(slug, force ? undefined : etagRef.current ?? undefined);
        if (!mountedRef.current) return;
        if (result.status === 304) {
          setState((prev) => ({ ...prev, status: prev.snapshot ? 'ready' : prev.status, error: null }));
          return;
        }
        const previousRevision = snapshotRef.current?.revision ?? null;
        etagRef.current = result.etag || null;
        snapshotRef.current = result.map;
        setState((prev) => ({
          status: 'ready',
          snapshot: result.map,
          error: null,
          liveUpdates:
            previousRevision !== null && result.map.revision !== previousRevision
              ? prev.liveUpdates + 1
              : prev.liveUpdates,
        }));
      } catch (error) {
        if (!mountedRef.current) return;
        if (error instanceof ApiClientError && error.status === 404) {
          etagRef.current = null;
          setState({ status: 'not-found', snapshot: null, error: 'Карта не найдена или снята с публикации', liveUpdates: 0 });
          snapshotRef.current = null;
          return;
        }
        const message = error instanceof Error ? error.message : 'Не удалось загрузить карту';
        setState((prev) =>
          prev.snapshot
            ? { ...prev, status: 'ready', error: message }
            : { status: 'error', snapshot: null, error: message, liveUpdates: 0 },
        );
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current) setRefreshing(false);
      }
    },
    [slug],
  );

  useEffect(() => {
    mountedRef.current = true;
    etagRef.current = null;
    snapshotRef.current = null;
    setState({ status: 'loading', snapshot: null, error: null, liveUpdates: 0 });
    void load(true);

    if (!live) {
      return () => {
        mountedRef.current = false;
      };
    }

    const interval = window.setInterval(() => void load(false), pollMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [slug, live, pollMs, load]);

  const refresh = useCallback(async () => {
    await load(true);
  }, [load]);

  const model = state.snapshot ? buildVisitorModel(state.snapshot) : null;

  return {
    status: state.status,
    snapshot: state.snapshot,
    model,
    error: state.error,
    revision: state.snapshot?.revision ?? null,
    liveUpdates: state.liveUpdates,
    refreshing,
    refresh,
  };
}
