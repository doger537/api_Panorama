import { useEffect, useRef, useState } from 'react';
import type { AssetRef, Capture } from '../../../../CONTRACTS/types';
import { apiClient } from '../../shared/api';

interface CaptureJobOptions {
  mapId: string | null;
  capture: Capture | null;
  pollMs: number;
  onUpdate: (capture: Capture) => void;
  onReady: (asset: AssetRef, capture: Capture) => void;
}

/** Polls without overlapping requests; importing a completed result is retryable. */
export function useCaptureJob({ mapId, capture, pollMs, onUpdate, onReady }: CaptureJobOptions) {
  const callbacks = useRef({ onUpdate, onReady });
  callbacks.current = { onUpdate, onReady };
  const delivered = useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const [importedAssetId, setImportedAssetId] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const captureId = capture?.id;
  const state = capture?.state;
  const resultId = capture?.result_asset_id;

  useEffect(() => {
    setError(null);
    if (!mapId || !captureId || !capture || !['queued', 'running', 'succeeded'].includes(capture.state)) return;
    let disposed = false;
    let timer: number | undefined;
    let current = capture;

    const poll = async () => {
      try {
        if (current.state !== 'succeeded') {
          current = await apiClient.getCapture(mapId, captureId);
          if (disposed) return;
          setError(null);
          callbacks.current.onUpdate(current);
          // A transition to succeeded starts a dedicated result-import effect.
          // Do not race a second asset request against that effect.
          return;
        }
        if (current.state === 'succeeded') {
          const assetId = current.result_asset_id;
          if (!assetId) throw new Error('В результате склейки отсутствует панорама.');
          if (!delivered.current.has(assetId)) {
            const assets = await apiClient.listAssets(mapId);
            if (disposed) return;
            const asset = assets.find((item) => item.id === assetId);
            if (!asset) throw new Error('Готовая панорама пока недоступна.');
            callbacks.current.onReady(asset, current);
            delivered.current.add(assetId);
            // Keep the ID until the next capture starts. A reload before the
            // organizer saves the map must be able to re-import this result.
          }
          setImportedAssetId(assetId);
          setError(null);
        }
      } catch {
        if (disposed) return;
        setError(current.state === 'succeeded'
          ? 'Панорама готова, но получить её не удалось. Повторите получение результата.'
          : 'Не удалось обновить состояние склейки. Проверка будет повторена.');
      } finally {
        if (!disposed && (current.state === 'queued' || current.state === 'running')) {
          timer = window.setTimeout(poll, pollMs);
        }
      }
    };

    timer = window.setTimeout(poll, state === 'succeeded' ? 0 : pollMs);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [mapId, captureId, state, resultId, pollMs, retry]);

  return {
    error,
    awaitingResult: state === 'succeeded' && (!resultId || resultId !== importedAssetId),
    retryResult: () => setRetry((value) => value + 1),
  };
}
