import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetRef } from '../../../../CONTRACTS/types';
import {
  type PannellumApi,
  type PannellumViewerLike,
  loadPannellum,
} from './pannellumLoader';
import { clampHfov, pitchBounds, type PannellumHotspotConfig } from './hotspots';
import './panorama.css';

export interface PanoramaViewModel {
  yaw: number;
  pitch: number;
  hfov: number;
}

export interface PannellumViewportProps {
  /** URL of the first variant to show. */
  imageUrl: string;
  /** Low-resolution placeholder rendered while the main sphere loads. */
  previewUrl?: string | null;
  asset?: AssetRef | null;
  hotspots?: PannellumHotspotConfig[];
  initialYawDeg?: number;
  initialHfovDeg?: number;
  editable?: boolean;
  /** Called once the viewer exists and after it is destroyed (null). */
  onViewerReady?: (viewer: PannellumViewerLike | null) => void;
  onViewChanged?: (view: PanoramaViewModel) => void;
  /** Double click in editable mode: sphere coordinates under the pointer. */
  onPickPoint?: (point: { yaw: number; pitch: number }) => void;
  onError?: (error: Error) => void;
  className?: string;
}

function viewerConfig(props: PannellumViewportProps): Record<string, unknown> {
  const { asset } = props;
  const bounds = pitchBounds(asset);
  return {
    type: 'equirectangular',
    panorama: props.imageUrl,
    preview: props.previewUrl || undefined,
    haov: asset?.haov_deg ?? 360,
    vaov: asset?.vaov_deg ?? 180,
    vOffset: asset?.v_offset_deg ?? 0,
    yaw: props.initialYawDeg ?? 0,
    pitch: 0,
    hfov: clampHfov(props.initialHfovDeg ?? 100),
    minHfov: 40,
    maxHfov: 130,
    minPitch: bounds.minPitch,
    maxPitch: bounds.maxPitch,
    showControls: false,
    showFullscreenCtrl: false,
    compass: false,
    autoLoad: true,
    backgroundColor: [15, 23, 42],
    hotSpots: props.hotspots ?? [],
  };
}

function hotspotSignature(hotspot: PannellumHotspotConfig): string {
  return [
    hotspot.type,
    hotspot.cssClass,
    hotspot.pitch,
    hotspot.yaw,
    hotspot.createTooltipArgs?.label,
    JSON.stringify(hotspot.clickHandlerArgs),
  ].join('|');
}

export const PannellumViewport: React.FC<PannellumViewportProps> = (props) => {
  const {
    imageUrl,
    previewUrl,
    asset,
    hotspots = [],
    initialYawDeg = 0,
    initialHfovDeg,
    editable = false,
    onViewerReady,
    onViewChanged,
    onPickPoint,
    onError,
    className,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<PannellumViewerLike | null>(null);
  const appliedHotspotsRef = useRef<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const reportError = useCallback(
    (error: Error) => {
      setFailure(error.message);
      setLoading(false);
      onError?.(error);
    },
    [onError],
  );

  // Create (or re-create) the Pannellum viewer for the current sphere.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !imageUrl) return;
    let disposed = false;
    setLoading(true);
    setReady(false);
    setFailure(null);
    container.innerHTML = '';
    appliedHotspotsRef.current = new Map();

    let viewer: PannellumViewerLike | null = null;

    const boot = async () => {
      let api: PannellumApi;
      try {
        api = await loadPannellum();
      } catch (error) {
        if (disposed) return;
        reportError(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (disposed || !containerRef.current) return;
      try {
        viewer = api.viewer(containerRef.current, viewerConfig(props));
      } catch (error) {
        reportError(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      viewerRef.current = viewer;
      // Hotspots are part of the initial config; remember them so the diffing
      // effect below does not add them twice.
      appliedHotspotsRef.current = new Map(hotspots.map((hotspot) => [hotspot.id, hotspotSignature(hotspot)]));
      viewer.on('error', (message) => {
        if (!disposed) reportError(new Error(typeof message === 'string' ? message : 'Не удалось загрузить панораму'));
      });
      viewer.on('load', () => {
        if (disposed) return;
        // Fresh spherical projection: drop the "click point" listener below.
        setLoading(false);
      });
      viewer.setHfovBounds([40, 130]);
      setReady(true);
      onViewerReady?.(viewer);
    };

    void boot();

    return () => {
      disposed = true;
      appliedHotspotsRef.current = new Map();
      try {
        viewer?.destroy();
      } catch {
        /* Pannellum throws when the container is already detached. */
      }
      viewerRef.current = null;
      setReady(false);
      onViewerReady?.(null);
    };
    // `hotspots` and callbacks are intentionally excluded: the viewer is only
    // rebuilt when the sphere itself (or the starting orientation) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, previewUrl, asset?.id, initialYawDeg, editable]);

  // Keep the rendered hotspot set in sync with the document being edited.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const next = new Map(hotspots.map((hotspot) => [hotspot.id, hotspotSignature(hotspot)]));
    for (const id of Array.from(appliedHotspotsRef.current.keys())) {
      if (!next.has(id)) {
        try {
          viewer.removeHotSpot(id);
        } catch {
          /* ignore unknown ids */
        }
      }
    }
    for (const hotspot of hotspots) {
      if (appliedHotspotsRef.current.get(hotspot.id) === next.get(hotspot.id)) continue;
      try {
        viewer.removeHotSpot(hotspot.id);
        viewer.addHotSpot(hotspot);
      } catch {
        /* ignore unsupported hotspot payloads */
      }
    }
    appliedHotspotsRef.current = next;
  }, [hotspots, ready]);

  // Editable mode: double click picks sphere coordinates for a new hotspot.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !editable || !onPickPoint) return;
    const container = viewer.getContainer();
    const handleDoubleClick = (event: MouseEvent) => {
      const coords = viewer.mouseEventToCoords(event);
      if (!coords) return;
      const [pitch, yaw] = coords;
      onPickPoint({ yaw, pitch });
    };
    container.addEventListener('dblclick', handleDoubleClick);
    return () => container.removeEventListener('dblclick', handleDoubleClick);
  }, [editable, onPickPoint, ready]);

  // Report the current orientation for the header readouts (Pannellum has no
  // continuous "view changed" event, so a cheap poll is used instead).
  useEffect(() => {
    if (!onViewChanged) return;
    const timer = window.setInterval(() => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      try {
        onViewChanged({ yaw: viewer.getYaw(), pitch: viewer.getPitch(), hfov: viewer.getHfov() });
      } catch {
        /* viewer destroyed between ticks */
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [onViewChanged]);

  return (
    <div className={`ttk-pano-stage ${className ?? ''}`.trim()}>
      <div ref={containerRef} className="w-full h-full" data-testid="pannellum-container" />
      {loading && !failure && (
        <div className="ttk-pano-loading" role="status">
          <span className="animate-pulse">Загружаем сферу 360°…</span>
        </div>
      )}
      {failure && (
        <div className="ttk-pano-fallback" data-testid="pannellum-fallback">
          <img src={imageUrl} alt="" aria-hidden />
          <div className="ttk-pano-fallback__notice">
            <strong className="block mb-1">Интерактивный 3D-просмотр недоступен</strong>
            Не удалось загрузить изображение или запустить WebGL. Проверьте соединение
            и откройте панораму снова.
          </div>
        </div>
      )}
    </div>
  );
};
