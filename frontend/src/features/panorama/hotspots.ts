import type { AssetRef, Hotspot, Panorama, Poi } from '../../../../CONTRACTS/types';
import { normalizeYaw } from '../../shared/coordinates';

export type HotspotActivation =
  | { kind: 'poi'; poiId: string }
  | { kind: 'transition'; panoramaId: string };

export interface PannellumHotspotConfig {
  id: string;
  pitch: number;
  yaw: number;
  type: 'info' | 'custom';
  cssClass: string;
  createTooltipFunc: (div: HTMLElement, args: { label: string }) => void;
  createTooltipArgs: { label: string };
  clickHandlerFunc: (event: unknown, args: HotspotActivation) => void;
  clickHandlerArgs: HotspotActivation;
}

export const HOTSPOT_CSS_CLASS: Record<Hotspot['kind'], string> = {
  poi: 'ttk-pano-hotspot ttk-pano-hotspot--poi',
  transition: 'ttk-pano-hotspot ttk-pano-hotspot--transition',
};

export const DEFAULT_PITCH_LIMIT = 85;

/** Keeps organizer input inside the range Pannellum can render without flipping. */
export function clampHotspotAngles(yawDeg: number, pitchDeg: number): { yaw: number; pitch: number } {
  const pitch = Number.isFinite(pitchDeg) ? Math.max(-89, Math.min(89, pitchDeg)) : 0;
  const yaw = Number.isFinite(yawDeg) ? normalizeYaw(Math.round(normalizeYaw(yawDeg) * 10) / 10) : 0;
  return { yaw, pitch: Math.round(pitch * 10) / 10 };
}

/**
 * Vertical look-around limits derived from the measured sphere coverage.
 * A panorama stitched with 120° of vertical coverage must not let the visitor
 * pitch into empty black space.
 */
export function pitchBounds(asset: AssetRef | null | undefined): { minPitch: number; maxPitch: number } {
  const vaov = asset?.vaov_deg;
  if (!vaov || !Number.isFinite(vaov) || vaov >= 179) {
    return { minPitch: -DEFAULT_PITCH_LIMIT, maxPitch: DEFAULT_PITCH_LIMIT };
  }
  const offset = asset?.v_offset_deg ?? 0;
  const half = Math.max(10, Math.min(90, vaov / 2));
  return {
    minPitch: Math.max(-89, Math.round((offset - half) * 10) / 10),
    maxPitch: Math.min(89, Math.round((offset + half) * 10) / 10),
  };
}

export function hotspotLabel(hotspot: Hotspot, pois: Poi[], panoramas: Panorama[]): string {
  if (hotspot.kind === 'poi') {
    const poi = pois.find((item) => item.id === hotspot.poi_id);
    return poi?.title || 'Точка интереса';
  }
  const target = panoramas.find((item) => item.id === hotspot.target_panorama_id);
  return target?.title ? `Переход: ${target.title}` : 'Переход к панораме';
}

/**
 * Converts contract hotspots (yaw/pitch relative to the panorama heading) into
 * Pannellum hotspot configuration objects. Pure by design: activation is
 * reported through `onActivate`, so it can be asserted in unit tests.
 */
export function buildViewerHotspots(params: {
  panorama: Panorama | null;
  hotspots: Hotspot[];
  pois: Poi[];
  panoramas: Panorama[];
  onActivate?: (activation: HotspotActivation, hotspot: Hotspot) => void;
}): PannellumHotspotConfig[] {
  const { panorama, hotspots, pois, panoramas, onActivate } = params;
  if (!panorama) return [];

  return hotspots
    .filter((hotspot) => hotspot.panorama_id === panorama.id)
    .filter((hotspot) => (hotspot.kind === 'poi' ? Boolean(hotspot.poi_id) : Boolean(hotspot.target_panorama_id)))
    .map((hotspot) => {
      const angles = clampHotspotAngles(hotspot.yaw_deg, hotspot.pitch_deg);
      const activation: HotspotActivation =
        hotspot.kind === 'poi'
          ? { kind: 'poi', poiId: hotspot.poi_id as string }
          : { kind: 'transition', panoramaId: hotspot.target_panorama_id as string };
      const label = hotspotLabel(hotspot, pois, panoramas);
      return {
        id: hotspot.id,
        pitch: angles.pitch,
        yaw: angles.yaw,
        type: hotspot.kind === 'transition' ? 'custom' : 'info',
        cssClass: HOTSPOT_CSS_CLASS[hotspot.kind],
        createTooltipFunc: (div: HTMLElement, args: { label: string }) => {
          const span = div.ownerDocument.createElement('span');
          span.className = 'ttk-pano-hotspot__label';
          span.textContent = args.label;
          div.appendChild(span);
        },
        createTooltipArgs: { label },
        clickHandlerFunc: (_event: unknown, args: HotspotActivation) => {
          onActivate?.(args, hotspot);
        },
        clickHandlerArgs: activation,
      };
    });
}

/** Hotspots that point to a POI removed from the document are silently ignored. */
export function countDanglingHotspots(hotspots: Hotspot[], pois: Poi[], panoramas: Panorama[]): number {
  const poiIds = new Set(pois.map((poi) => poi.id));
  const panoramaIds = new Set(panoramas.map((panorama) => panorama.id));
  return hotspots.filter((hotspot) =>
    hotspot.kind === 'poi'
      ? !hotspot.poi_id || !poiIds.has(hotspot.poi_id)
      : !hotspot.target_panorama_id || !panoramaIds.has(hotspot.target_panorama_id),
  ).length;
}

export function hfovLimits(): { min: number; max: number } {
  return { min: 40, max: 130 };
}

export function clampHfov(value: number): number {
  const limits = hfovLimits();
  if (!Number.isFinite(value)) return 100;
  return Math.max(limits.min, Math.min(limits.max, value));
}
