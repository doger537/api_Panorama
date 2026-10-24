import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssetRef, Capture, MapDocument } from '../../../../CONTRACTS/types';
import { ApiClientError, apiClient } from '../../shared/api';
import { Icon } from '../../shared/Icon';
import { CapturePointPicker } from './CapturePointPicker';
import {
  CAPTURE_PHASE_LABELS, STEP_DEG, TOTAL_FRAMES, canRetry, captureErrorHint,
  captureStateLabel, compassGuidance, detectOrientationSupport, nextFrameIndex,
  shootingProgress, targetAngleFor, type CapturePhase,
} from './guide';
import { clearSession, loadSession, saveSession } from './session';
import { useCaptureCamera } from './useCaptureCamera';
import { storePendingFrame, loadPendingFrame, clearPendingFrame } from './pendingFrameStore';
import { useCaptureJob } from './useCaptureJob';
import './capture.css';

export interface CaptureGuideProps {
  mapId: string | null;
  isAuthenticated: boolean;
  onNotify: (msg: string) => void;
  onPanoramaAssetReady?: (asset: AssetRef, title: string, x: number, y: number) => void;
  mapDocument?: MapDocument | null;
  widthUnits?: number;
  heightUnits?: number;
  pollMs?: number;
  /** Test seam for frame encoding, never a replacement for stored pending frames. */
  captureFrame?: (index: number) => Promise<File>;
}

type Notice = { text: string; tone: 'info' | 'warning' | 'error' } | null;
type PendingFrame = { captureId: string; index: number; file: File; url: string };
const DEFAULT_HFOV = 65;

/** Changing the map or auth context disposes the old stream and pending requests. */
export const CaptureGuide: React.FC<CaptureGuideProps> = (props) => (
  <CaptureGuideSession key={`${props.mapId ?? 'none'}:${props.isAuthenticated}`} {...props} />
);

function CaptureGuideSession({
  mapId, isAuthenticated, onPanoramaAssetReady, mapDocument = null,
  widthUnits = 700, heightUnits = 500, pollMs = 2000, captureFrame,
}: CaptureGuideProps) {
  const [phase, setPhase] = useState<CapturePhase>('idle');
  const [title, setTitle] = useState('Панорама зала');
  const [point, setPoint] = useState({ x: widthUnits / 2, y: heightUnits / 2 });
  const [activeCapture, setActiveCapture] = useState<Capture | null>(null);
  const [pendingFrame, setPendingFrame] = useState<PendingFrame | null>(null);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [durableFrame, setDurableFrame] = useState(true);
  const [busy, setBusy] = useState(false);
  const [headingDeg, setHeadingDeg] = useState<number | null>(null);
  const [orientationGranted, setOrientationGranted] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [isUploadingPano, setIsUploadingPano] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const storedSession = useMemo(() => mapId && isAuthenticated ? loadSession(mapId) : null, [mapId, isAuthenticated]);
  const [restoring, setRestoring] = useState(Boolean(storedSession));
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const camera = useCaptureCamera();
  const cameraSupport = camera.support;
  const cameraError = camera.error;
  const orientationSupport = useMemo(() => detectOrientationSupport(), []);
  const alive = useRef(true);
  const busyRef = useRef(false);
  const readyPanoInputRef = useRef<HTMLInputElement | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const frames = activeCapture?.frames ?? [];
  const nextIndex = nextFrameIndex(frames);
  const covered = frames.length;
  const guide = compassGuidance(targetAngleFor(nextIndex), headingDeg);
  const progress = shootingProgress(frames);

  const pushNotice = useCallback((text: string, tone: 'info' | 'warning' | 'error' = 'info') => {
    if (!alive.current) return;
    setNotice({ text, tone });
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    if (tone !== 'error') noticeTimerRef.current = window.setTimeout(() => setNotice(null), 5000);
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (pendingFrame) return () => URL.revokeObjectURL(pendingFrame.url);
  }, [pendingFrame]);

  useEffect(() => {
    if (!('DeviceOrientationEvent' in window)) return;
    const handler = (event: DeviceOrientationEvent) => {
      if (typeof event.alpha === 'number') setHeadingDeg(Math.round(event.alpha));
    };
    window.addEventListener('deviceorientation', handler);
    return () => window.removeEventListener('deviceorientation', handler);
  }, []);

  useEffect(() => {
    if (!mapId || !storedSession) return;
    let disposed = false;
    setRestoring(true);
    setRestoreError(null);
    void apiClient.getCapture(mapId, storedSession.captureId).then(async (restored) => {
      if (disposed) return;
      setActiveCapture(restored);
      setTitle(restored.title);
      setPoint({ x: restored.x, y: restored.y });
      if (restored.state === 'queued' || restored.state === 'running') {
        camera.stop();
        setPhase('queued');
      }
      if (restored.state === 'collecting') {
        const pending = await loadPendingFrame(mapId);
        if (disposed) return;
        if (pending && pending.captureId === restored.id) {
          setPendingFrame({ ...pending, url: URL.createObjectURL(pending.file) });
          setPhase('reviewing');
        }
        pushNotice(`Сессия восстановлена: ${restored.frames.length}/${TOTAL_FRAMES} кадров уже загружено`);
      }
    }).catch((error: unknown) => {
      if (disposed) return;
      if (error instanceof ApiClientError && error.status === 404) {
        clearSession(mapId);
      } else {
        setRestoreError('Не удалось восстановить съёмку. Проверьте связь и повторите попытку.');
      }
    }).finally(() => {
      if (!disposed) setRestoring(false);
    });
    return () => { disposed = true; };
  }, [mapId, storedSession, restoreAttempt, camera.stop, pushNotice]);

  const job = useCaptureJob({
    mapId, capture: activeCapture, pollMs,
    onUpdate: (updated) => {
      setActiveCapture(updated);
      if (updated.state === 'failed' || updated.state === 'cancelled' || updated.state === 'succeeded') {
        setPhase('idle');
      }
      if (updated.state === 'failed') pushNotice(captureErrorHint(updated.error_code), 'error');
    },
    onReady: (asset, capture) => {
      onPanoramaAssetReady?.(asset, capture.title, capture.x, capture.y);
      setPhase('idle');
      pushNotice('Панорама готова. Сохраните карту после добавления в редактор.');
    },
  });

  // One user mutation at a time, including the await before React re-renders.
  async function runAction(operation: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await operation();
    } catch (error) {
      if (alive.current) pushNotice(error instanceof Error ? error.message : 'Не удалось выполнить действие. Повторите попытку.', 'error');
    } finally {
      if (alive.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }

  async function requestOrientationPermission() {
    try {
      const orientation = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      const result = orientationSupport === 'permission-needed' ? await orientation.requestPermission!() : 'granted';
      if (alive.current) setOrientationGranted(result === 'granted');
    } catch {
      if (alive.current) setOrientationGranted(false);
    }
  }

  function startCamera() {
    if (!mapId || !isAuthenticated || busyRef.current || restoring || restoreError || job.awaitingResult
        || activeCapture?.state === 'queued' || activeCapture?.state === 'running') return;
    // iOS requires requesting sensor permission directly from the click gesture.
    void requestOrientationPermission();
    void runAction(async () => {
      if (activeCapture && activeCapture.state !== 'collecting') {
        setActiveCapture(null);
        clearSession(mapId);
      }
      setPhase('preparing');
      const started = await camera.start();
      if (!alive.current) return;
      setPhase(started ? 'capturing' : 'idle');
      if (started) pushNotice('Держите телефон вертикально и поворачивайтесь на 22,5° после каждого кадра');
    });
  }

  async function shootFrame() {
    if (!mapId || !isAuthenticated || restoring || restoreError || pendingFrame) return;
    await runAction(async () => {
      const collecting = activeCapture?.state === 'collecting' ? activeCapture : null;
      const index = nextFrameIndex(collecting?.frames ?? []);
      if (index >= TOTAL_FRAMES) return;
      const file = await (captureFrame ?? camera.capture)(index);
      if (!alive.current) return;
      const capture = collecting ?? await apiClient.createCapture(mapId, {
        title: title.trim() || 'Панорама 360°', x: point.x, y: point.y, hfov_hint_deg: DEFAULT_HFOV,
      });
      // The request may finish after navigation. Keep the server session
      // discoverable when this map is opened again, without updating the old UI.
      saveSession(mapId, { captureId: capture.id, mapId, title: capture.title, x: capture.x, y: capture.y });
      const persisted = await storePendingFrame({ mapId, captureId: capture.id, index, file });
      if (!alive.current) return;
      setDurableFrame(persisted);
      setActiveCapture(capture);
      setPendingFrame({ captureId: capture.id, index, file, url: URL.createObjectURL(file) });
      setUploadFailed(false);
      setPhase('reviewing');
    });
  }

  function retakeFrame() {
    void runAction(async () => {
      if (mapId) await clearPendingFrame(mapId);
      if (!alive.current) return;
      setPendingFrame(null); setUploadFailed(false); setPhase('capturing');
      if (!camera.active) { const started = await camera.start(); if (!alive.current) return; if (!started) setPhase('idle'); }
      pushNotice('Кадр отменён: снимите его заново с тем же ориентиром');
    });
  }

  async function submitStitch(capture: Capture) {
    if (!mapId) return;
    const queued = await apiClient.startStitch(mapId, capture.id);
    if (!alive.current) return;
    setActiveCapture(queued);
    setPhase(queued.state === 'queued' || queued.state === 'running' ? 'queued' : 'idle');
    camera.stop();
    pushNotice('Все 16 кадров загружены: состояние склейки проверяется на сервере');
  }

  async function acceptFrame() {
    if (!mapId || !pendingFrame || activeCapture?.id !== pendingFrame.captureId) return;
    await runAction(async () => {
      setPhase('uploading');
      let updated: Capture;
      try {
        updated = await apiClient.uploadCaptureFrame(mapId, pendingFrame.captureId, pendingFrame.index, { file: pendingFrame.file });
      } catch (error) {
        if (alive.current) {
          setUploadFailed(true);
          setPhase('reviewing');
        }
        throw error;
      }
      if (!alive.current) return;
      await clearPendingFrame(mapId);
      if (!alive.current) return;
      setActiveCapture(updated);
      setPendingFrame(null);
      setUploadFailed(false);
      setPhase(camera.active || captureFrame ? 'capturing' : 'idle');
      if (updated.frames.length === TOTAL_FRAMES) {
        await submitStitch(updated);
      } else {
        pushNotice(`Кадр ${updated.frames.length}/${TOTAL_FRAMES} сохранён · следующий ориентир ${targetAngleFor(nextFrameIndex(updated.frames)).toFixed(1)}°`);
      }
    });
  }

  async function cancelCapture() {
    await runAction(async () => {
      const cancelled = mapId && activeCapture
        ? await apiClient.cancelCapture(mapId, activeCapture.id)
        : null;
      if (!alive.current) return;
      camera.stop();
      setPendingFrame(null);
      setActiveCapture(cancelled);
      setPhase('idle');
      if (mapId) { clearSession(mapId); await clearPendingFrame(mapId); }
      pushNotice('Сессия съёмки отменена');
    });
  }

  async function uploadReadyPanorama(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!mapId || !isAuthenticated) {
      pushNotice('Войдите как организатор, чтобы загрузить панораму', 'warning');
      return;
    }
    if (isUploadingPano) return;
    setIsUploadingPano(true);
    try {
      const asset = await apiClient.uploadAsset(mapId, { kind: 'panorama', file });
      if (!alive.current) return;
      onPanoramaAssetReady?.(asset, title.trim() || file.name, point.x, point.y);
      pushNotice('Готовая панорама 2:1 добавлена в редактор. Сохраните карту.');
    } catch (error) {
      if (alive.current) pushNotice(error instanceof Error ? error.message : 'Ошибка загрузки панорамы', 'error');
    } finally {
      if (alive.current) setIsUploadingPano(false);
    }
  }

  /* --------------------------- render --------------------------- */

  const jobFailed = activeCapture?.state === 'failed';
  const jobActive = activeCapture?.state === 'queued' || activeCapture?.state === 'running';
  const showPicker = Boolean(mapId);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 space-y-4 shadow-sm">
      <header className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
            <Icon name="camera" className="w-4 h-4 text-brand-600" /> 2. Мастер съемки панорам с телефона
          </h3>
          <p className="text-xs text-slate-400">
            Инструкция и гид по сшивке серий кадров (16 кадров • шаг 22.5°)
          </p>
        </div>
        <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-200 whitespace-nowrap">
          {CAPTURE_PHASE_LABELS[phase]}
        </span>
      </header>

      {showPicker && (
        <div className="space-y-2">
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Название панорамы"
            aria-label="Название панорамы"
            disabled={activeCapture?.state === 'collecting' || busy || restoring}
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs"
          />
          <CapturePointPicker
            widthUnits={widthUnits}
            heightUnits={heightUnits}
            document={mapDocument}
            value={point}
            onChange={(next) => {
              if (!busy && !restoring && activeCapture?.state !== 'collecting') setPoint(next);
            }}
            existing={(mapDocument?.panoramas ?? []).map((panorama) => ({
              id: panorama.id,
              x: panorama.x,
              y: panorama.y,
              title: panorama.title,
            }))}
          />
        </div>
      )}

      {notice && (
        <div
          className={`ttk-capture-guide__notice ttk-capture-guide__notice--${
            notice.tone === 'error' ? 'error' : notice.tone === 'warning' ? 'warning' : 'info'
          }`}
          role="status"
        >
          {notice.text}
        </div>
      )}

      {!durableFrame && pendingFrame && <p role="status">Хранилище браузера недоступно. Не закрывайте вкладку до загрузки кадра.</p>}
      {restoring && <p role="status">Восстанавливаем сессию съёмки…</p>}
      {restoreError && (
        <div role="alert" className="ttk-capture-guide__notice ttk-capture-guide__notice--error">
          <p>{restoreError}</p>
          <button type="button" onClick={() => setRestoreAttempt((value) => value + 1)}>Повторить восстановление</button>
        </div>
      )}

      {cameraError && (
        <div className="ttk-capture-guide__notice ttk-capture-guide__notice--warning" role="alert">
          {cameraError}
          {phase === 'capturing' && <button type="button" disabled={busy} onClick={startCamera}>Открыть камеру снова</button>}
        </div>
      )}

      {!cameraSupport.usable && !cameraError && (
        <div className="ttk-capture-guide__notice ttk-capture-guide__notice--warning">
          {cameraSupport.reason}. Доступна загрузка готовой сферы 2:1.
        </div>
      )}

      {/* Shooting stage */}
      {(phase === 'capturing' || phase === 'reviewing' || phase === 'preparing' || phase === 'uploading') && (
        <div className="space-y-2">
          <div className="ttk-capture-guide__stage">
            <video ref={camera.bindVideo} autoPlay playsInline muted
              onLoadedData={camera.updateReady} onCanPlay={camera.updateReady} onEmptied={camera.updateReady}
              className="w-full h-full" />
            {pendingFrame && <img src={pendingFrame.url} alt={`Кадр ${pendingFrame.index + 1}`} className="ttk-capture-guide__preview" />}
            <div className="ttk-capture-guide__reticle" />
            <span
              className={`ttk-capture-guide__compass ${guide.aligned ? 'is-aligned' : ''}`}
              data-testid="compass-guidance"
            >
              {phase === 'reviewing'
                ? `Кадр ${(pendingFrame?.index ?? 0) + 1} из ${TOTAL_FRAMES} — проверьте кадр`
                : `${guide.text} · цель ${targetAngleFor(nextIndex).toFixed(1)}°`}
            </span>
          </div>

          <div className="ttk-capture-guide__dots" aria-hidden>
            {Array.from({ length: TOTAL_FRAMES }).map((_, index) => (
              <span
                key={index}
                className={`ttk-capture-guide__dot ${
                  index < covered ? 'is-done' : index === covered ? 'is-current' : ''
                }`}
              />
            ))}
          </div>
          <div className="flex items-center justify-between text-[11px] font-bold text-brand-600">
            <span>
              Снято {covered}/{TOTAL_FRAMES} · шаг {STEP_DEG}°
            </span>
            <span>{progress}%</span>
          </div>

          {pendingFrame ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={acceptFrame}
                disabled={busy}
                className="flex-1 bg-brand-600 hover:bg-brand-700 text-white py-2.5 rounded-xl text-xs font-bold"
              >
                {phase === 'uploading' ? 'Загрузка кадра…' : uploadFailed ? 'Повторить загрузку кадра' : 'Оставить кадр'}
              </button>
              <button
                type="button"
                onClick={retakeFrame}
                disabled={busy}
                className="flex-1 bg-slate-200 dark:bg-slate-700 py-2.5 rounded-xl text-xs font-bold"
              >
                Переснять
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void shootFrame()}
                disabled={busy || restoring || Boolean(restoreError) || nextIndex >= TOTAL_FRAMES || (!captureFrame && !camera.ready)}
                className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-xs font-bold"
              >
                {phase === 'uploading' ? 'Загрузка кадра…' : `Снять кадр ${nextIndex + 1}`}
              </button>
              <button
                type="button"
                onClick={() => void cancelCapture()}
                disabled={busy}
                className="px-3 py-2.5 bg-slate-200 dark:bg-slate-700 rounded-xl text-xs font-semibold"
              >
                Отмена
              </button>
            </div>
          )}
        </div>
      )}

      {/* Start button */}
      {phase === 'idle' && !jobActive && (
        <button
          type="button"
          onClick={() => void startCamera()}
          disabled={!cameraSupport.usable || !isAuthenticated || !mapId || busy || restoring || Boolean(restoreError) || job.awaitingResult}
          className="w-full bg-[#121824] hover:bg-slate-800 disabled:opacity-50 text-white py-3 rounded-2xl text-xs font-bold transition flex items-center justify-center gap-2"
        >
          <Icon name="video" className="w-4 h-4" /> Активировать камеру
        </button>
      )}

      {orientationSupport === 'permission-needed' && !orientationGranted && phase !== 'idle' && (
        <p className="text-[11px] text-slate-500">Разрешите доступ к датчикам, чтобы видеть подсказку компаса.</p>
      )}

      {/* Server job */}
      {activeCapture && (
        <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold">{captureStateLabel(activeCapture)}</span>
            <span className="text-slate-500">{activeCapture.progress}%</span>
          </div>
          {jobActive && (
            <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div className="h-full bg-brand-600 transition-all" style={{ width: `${activeCapture.progress}%` }} />
            </div>
          )}

          {jobFailed && (
            <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-200 space-y-2">
              <p className="font-semibold">{captureErrorHint(activeCapture.error_code)}</p>
              {activeCapture.error_message && <p className="opacity-80">{activeCapture.error_message}</p>}
              <div className="flex flex-wrap gap-2">
                {canRetry(activeCapture) && (
                  <button
                    type="button"
                    onClick={() => void runAction(() => submitStitch(activeCapture))}
                    disabled={busy}
                    className="px-3 py-1.5 bg-brand-600 text-white rounded-lg font-bold"
                  >
                    Повторить склейку (попытка {activeCapture.attempt + 1}/2)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => readyPanoInputRef.current?.click()}
                  className="px-3 py-1.5 bg-slate-800 text-white rounded-lg font-bold"
                >
                  Загрузить готовую сферу
                </button>
              </div>
            </div>
          )}

          {activeCapture.state === 'collecting' && covered === TOTAL_FRAMES && (
            <button
              type="button"
              onClick={() => void runAction(() => submitStitch(activeCapture))}
              disabled={busy}
              className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-700 rounded-lg font-semibold"
            >
              Запустить склейку
            </button>
          )}

          {(jobActive || (activeCapture.state === 'collecting' && (phase === 'idle' || phase === 'reviewing'))) && (
            <button type="button" disabled={busy} onClick={() => void cancelCapture()}>
              {jobActive ? 'Отменить склейку' : 'Отменить съёмку'}
            </button>
          )}
          {job.error && (
            <div role="alert" className="ttk-capture-guide__notice ttk-capture-guide__notice--error">
              <p>{job.error}</p>
              {job.awaitingResult && <button type="button" onClick={job.retryResult}>Получить готовую панораму</button>}
            </div>
          )}
        </div>
      )}

      {/* Ready panorama upload */}
      <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
        <input
          ref={readyPanoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          aria-label="Загрузить готовую панораму"
          onChange={(event) => void uploadReadyPanorama(event)}
        />
        <button
          type="button"
          onClick={() => readyPanoInputRef.current?.click()}
          disabled={isUploadingPano}
          className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:border-brand-600 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-2"
        >
          <Icon name="rotate-3d" className="w-4 h-4 text-brand-600" />
          <span>{isUploadingPano ? 'Загрузка сферы…' : 'Загрузить готовую 360° панораму (2:1)'}</span>
        </button>
      </div>
    </div>
  );
}
