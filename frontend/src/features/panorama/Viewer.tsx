import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import type { AssetRef, Hotspot, Panorama, Poi } from '../../../../CONTRACTS/types';
import { Icon } from '../../shared/Icon';
type RichPoiItem = { id: string; name: string; categoryName?: string; description: string; equipment?: string; wifi?: string; image?: string };
import {
  buildViewerHotspots,
  clampHfov,
  clampHotspotAngles,
  pitchBounds,
  type HotspotActivation,
  type PannellumHotspotConfig,
} from './hotspots';
import { PannellumViewport, type PanoramaViewModel } from './PannellumViewport';
import { VARIANT_LABELS, readViewportBudget, resolvePanoramaImage } from './media';
import type { PannellumViewerLike } from './pannellumLoader';

export interface PanoramaViewerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  imageUrl: string;
  panorama?: Panorama | null;
  panoramas?: Panorama[];
  hotspots?: Hotspot[];
  pois?: Poi[];
  richPois?: RichPoiItem[];
  assets?: AssetRef[];
  onSelectPanorama?: (panoramaId: string) => void;
  onSelectPoi?: (poiId: string) => void;
  editable?: boolean;
  onAddHotspot?: (hotspot: Omit<Hotspot, 'id'>) => void;
  onDeleteHotspot?: (hotspotId: string) => void;
  initialYawDeg?: number;
}

function formatAngle(value: number): string {
  const rounded = Math.round(value);
  return `${rounded}°`;
}

export const PanoramaViewer: React.FC<PanoramaViewerProps> = ({
  isOpen,
  onClose,
  title,
  imageUrl,
  panorama = null,
  panoramas = [],
  hotspots = [],
  pois = [],
  richPois = [],
  assets = [],
  onSelectPanorama,
  onSelectPoi,
  editable = false,
  onAddHotspot,
  onDeleteHotspot,
  initialYawDeg = 0,
}: PanoramaViewerProps) => {
  const [view, setView] = useState<PanoramaViewModel>({ yaw: initialYawDeg, pitch: 0, hfov: 100 });
  const [viewer, setViewer] = useState<PannellumViewerLike | null>(null);
  const [activePoiCardId, setActivePoiCardId] = useState<string | null>(null);
  const [editorKind, setEditorKind] = useState<'poi' | 'transition'>('poi');
  const [editorTargetId, setEditorTargetId] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forceFullQuality, setForceFullQuality] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && dialog.current) {
        const controls = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled),select,input,[tabindex="0"]'));
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keys);
    return () => { document.removeEventListener('keydown', keys); previous?.focus(); };
  }, [isOpen, onClose]);
  useEffect(() => { setLoadError(null); setForceFullQuality(false); }, [panorama?.id, isOpen]);

  const budget = useMemo(() => readViewportBudget(), []);
  const media = useMemo(
    () => resolvePanoramaImage(panorama, assets, imageUrl, budget),
    [panorama, assets, imageUrl, budget],
  );
  const sphereUrl = forceFullQuality && media.highQualityUrl ? media.highQualityUrl : media.initialUrl;
  const previewUrl = media.asset?.preview_url ?? null;
  const bounds = useMemo(() => pitchBounds(media.asset), [media.asset]);

  const currentHotspots = useMemo(
    () => (panorama ? hotspots.filter((hotspot) => hotspot.panorama_id === panorama.id) : []),
    [hotspots, panorama],
  );

  const handleActivate = useCallback(
    (activation: HotspotActivation) => {
      if (activation.kind === 'poi') {
        setActivePoiCardId(activation.poiId);
        onSelectPoi?.(activation.poiId);
        return;
      }
      if (activation.panoramaId === panorama?.id) return;
      setActivePoiCardId(null);
      onSelectPanorama?.(activation.panoramaId);
    },
    [onSelectPanorama, onSelectPoi, panorama?.id],
  );

  const viewerHotspots: PannellumHotspotConfig[] = useMemo(
    () =>
      buildViewerHotspots({
        panorama,
        hotspots,
        pois,
        panoramas,
        onActivate: handleActivate,
      }),
    [panorama, hotspots, pois, panoramas, handleActivate],
  );

  const handlePickPoint = useCallback(
    ({ yaw, pitch }: { yaw: number; pitch: number }) => {
      if (!editable || !panorama || !onAddHotspot) return;
      const angles = clampHotspotAngles(yaw, pitch);

      if (editorKind === 'poi') {
        const targetPoiId = editorTargetId || pois[0]?.id;
        if (!targetPoiId) return;
        onAddHotspot({
          panorama_id: panorama.id,
          kind: 'poi',
          yaw_deg: angles.yaw,
          pitch_deg: angles.pitch,
          poi_id: targetPoiId,
          target_panorama_id: null,
        });
        return;
      }

      const targetPano =
        panoramas.find((item) => item.id === editorTargetId && item.id !== panorama.id) ||
        panoramas.find((item) => item.id !== panorama.id);
      if (!targetPano) return;
      onAddHotspot({
        panorama_id: panorama.id,
        kind: 'transition',
        yaw_deg: angles.yaw,
        pitch_deg: angles.pitch,
        poi_id: null,
        target_panorama_id: targetPano.id,
      });
    },
    [editable, panorama, onAddHotspot, editorKind, editorTargetId, pois, panoramas],
  );

  const zoomBy = useCallback(
    (delta: number) => {
      if (viewer) {
        const next = clampHfov(viewer.getHfov() + delta);
        viewer.setHfov(next, 300);
        setView((prev) => ({ ...prev, hfov: next }));
        return;
      }
      setView((prev) => ({ ...prev, hfov: clampHfov(prev.hfov + delta) }));
    },
    [viewer],
  );

  const recenter = useCallback(() => {
    if (!viewer) return;
    viewer.lookAt(0, 0, 100, 600);
    viewer.setHfov(100, 400);
  }, [viewer]);

  if (!isOpen) return null;

  const activePoi = activePoiCardId ? pois.find((poi) => poi.id === activePoiCardId) : null;
  const activeRichPoi = activePoiCardId ? richPois.find((poi) => poi.id === activePoiCardId) : null;
  const transitionTargets = panoramas.filter((item) => item.id !== panorama?.id);
  const canEdit = editable && Boolean(panorama);

  return (
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={title || 'Панорама'} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4">
      <div className="bg-slate-900 rounded-2xl sm:rounded-3xl w-full max-w-4xl overflow-hidden shadow-2xl border border-slate-800 flex flex-col h-[82vh] max-h-[640px] relative animate-modal-enter">
        {/* Header */}
        <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex items-center justify-between text-white z-10 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Icon name="rotate-3d" className="w-5 h-5 text-brand-500 shrink-0" />
            <div className="min-w-0">
              <h3 className="font-bold text-base truncate">{title || panorama?.title || 'Панорама 360°'}</h3>
              <p className="text-[11px] text-slate-400 truncate" data-testid="pano-readout">
                Азимут: {formatAngle(view.yaw)} • Наклон: {formatAngle(view.pitch)} • Угол обзора:{' '}
                {Math.round(view.hfov)}° • {VARIANT_LABELS[forceFullQuality && media.highQualityUrl ? 'full' : media.plan.initial]}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {media.highQualityUrl && (
              <button
                onClick={() => setForceFullQuality((prev) => !prev)}
                className={`px-2.5 py-1.5 rounded-full text-[11px] font-bold transition ${
                  forceFullQuality ? 'bg-brand-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                }`}
                title="Переключить качество сферы"
                aria-pressed={forceFullQuality}
              >
                HD
              </button>
            )}
            <button
              onClick={() => zoomBy(15)}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-white rounded-full transition"
              title="Отдалить"
              aria-label="Отдалить"
            >
              <Icon name="zoom-out" className="w-4 h-4" />
            </button>
            <button
              onClick={() => zoomBy(-15)}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-white rounded-full transition"
              title="Приблизить"
              aria-label="Приблизить"
            >
              <Icon name="zoom-in" className="w-4 h-4" />
            </button>
            <button
              onClick={recenter}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-white rounded-full transition"
              title="Сбросить вид"
              aria-label="Сбросить вид"
            >
              <Icon name="maximize-2" className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-white rounded-full transition"
              aria-label="Закрыть панораму"
            >
              <Icon name="x" className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Editable hotspot toolbar */}
        {canEdit && (
          <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center gap-2 text-xs text-slate-200 z-10">
            <span className="font-semibold text-brand-500">
              Разметка: выберите цель и поверните обзор к ней.
            </span>
            <select
              value={editorKind}
              onChange={(event) => setEditorKind(event.target.value as 'poi' | 'transition')}
              className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs"
              aria-label="Тип хотспота"
            >
              <option value="poi">Инфо-точка (POI)</option>
              <option value="transition">Переход к панораме</option>
            </select>
            {editorKind === 'poi' ? (
              <select
                value={editorTargetId}
                onChange={(event) => setEditorTargetId(event.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs"
                aria-label="Целевой POI"
              >
                {pois.length === 0 && <option value="">Сначала добавьте POI на план</option>}
                {pois.map((poi) => (
                  <option key={poi.id} value={poi.id}>
                    {poi.title}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={editorTargetId}
                onChange={(event) => setEditorTargetId(event.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs"
                aria-label="Целевая панорама"
              >
                {transitionTargets.length === 0 && <option value="">Нет второй панорамы</option>}
                {transitionTargets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            )}
            <button onClick={() => handlePickPoint({ yaw: view.yaw, pitch: view.pitch })} className="px-3 py-2 bg-brand-600 rounded-lg">Добавить хотспот в центре</button>
            <span className="text-[11px] text-slate-400">
              Добавлено хотспотов: {currentHotspots.length} • наклон ограничен{' '}
              {Math.round(bounds.minPitch)}…{Math.round(bounds.maxPitch)}°
            </span>
          </div>
        )}

        {/* 360 viewport */}
        <div className="flex-1 relative overflow-hidden">
          <PannellumViewport
            imageUrl={sphereUrl}
            previewUrl={previewUrl}
            asset={media.asset}
            hotspots={viewerHotspots}
            initialYawDeg={initialYawDeg}
            initialHfovDeg={100}
            editable={canEdit}
            onViewerReady={setViewer}
            onViewChanged={setView}
            onPickPoint={handlePickPoint}
            onError={(error) => setLoadError(error.message)}
          />

          {/* Hotspot list for editors: lets a hotspot be deleted without hunting it in the sphere */}
          {canEdit && currentHotspots.length > 0 && onDeleteHotspot && (
            <div className="absolute top-2 left-2 right-2 sm:right-auto sm:w-64 max-h-40 overflow-y-auto custom-scrollbar bg-slate-950/80 backdrop-blur-md rounded-xl border border-slate-700 p-2 space-y-1 z-20">
              {currentHotspots.map((hotspot) => {
                const label =
                  hotspot.kind === 'poi'
                    ? pois.find((poi) => poi.id === hotspot.poi_id)?.title || 'POI'
                    : `Переход: ${panoramas.find((item) => item.id === hotspot.target_panorama_id)?.title || '—'}`;
                return (
                  <div key={hotspot.id} className="flex items-center justify-between gap-2 text-[11px] text-slate-200">
                    <span className="truncate">
                      {hotspot.kind === 'transition' ? '→ ' : '• '}
                      {label} · {Math.round(hotspot.yaw_deg)}°
                    </span>
                    <button
                      onClick={() => onDeleteHotspot(hotspot.id)}
                      className="p-1 bg-red-600/90 hover:bg-red-500 text-white rounded-full shrink-0"
                      title="Удалить хотспот"
                      aria-label={`Удалить хотспот ${label}`}
                    >
                      <Icon name="x" className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* POI card opened from a hotspot */}
          {(activePoi || activeRichPoi) && (
            <div className="absolute bottom-4 left-4 right-4 sm:right-auto sm:w-80 bg-slate-950/90 text-white p-4 rounded-2xl border border-slate-700 backdrop-blur-md z-30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm">{activePoi?.title ?? activeRichPoi?.name}</span>
                <button
                  onClick={() => setActivePoiCardId(null)}
                  className="text-slate-400 hover:text-white"
                  aria-label="Закрыть карточку"
                >
                  <Icon name="x" className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-300">{activePoi?.description ?? activeRichPoi?.description}</p>
              {activePoi?.category_label && (
                <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-600/20 text-brand-500">
                  {activePoi.category_label}
                </span>
              )}
            </div>
          )}

          {loadError && !activePoi && !activeRichPoi && (
            <p className="absolute bottom-3 left-3 right-3 text-[11px] text-amber-300/90 z-30">{loadError}</p>
          )}
        </div>
      </div>
    </div>
  );
};
