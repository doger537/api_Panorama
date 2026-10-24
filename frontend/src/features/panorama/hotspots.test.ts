import { describe, it, expect, vi } from 'vitest';
import type { AssetRef, Hotspot, Panorama, Poi } from '../../../../CONTRACTS/types';
import {
  buildViewerHotspots,
  clampHfov,
  clampHotspotAngles,
  countDanglingHotspots,
  hotspotLabel,
  pitchBounds,
} from './hotspots';

const panoramas: Panorama[] = [
  { id: 'pano-1', asset_id: 'a1', title: 'Ресепшн', x: 0, y: 0, nav_node_id: 'n1', heading_offset_deg: 0 },
  { id: 'pano-2', asset_id: 'a2', title: 'Коридор', x: 10, y: 10, nav_node_id: 'n2', heading_offset_deg: 90 },
];

const pois: Poi[] = [
  {
    id: 'poi-1',
    title: 'Стенд ТТК',
    category: 'booth',
    category_label: null,
    description: '',
    x: 5,
    y: 5,
    nav_node_id: 'n1',
  },
];

const hotspots: Hotspot[] = [
  {
    id: 'hs-poi',
    panorama_id: 'pano-1',
    kind: 'poi',
    yaw_deg: 45,
    pitch_deg: -10,
    poi_id: 'poi-1',
    target_panorama_id: null,
  },
  {
    id: 'hs-transition',
    panorama_id: 'pano-1',
    kind: 'transition',
    yaw_deg: 190,
    pitch_deg: 5,
    poi_id: null,
    target_panorama_id: 'pano-2',
  },
  {
    id: 'hs-other-panorama',
    panorama_id: 'pano-2',
    kind: 'poi',
    yaw_deg: 0,
    pitch_deg: 0,
    poi_id: 'poi-1',
    target_panorama_id: null,
  },
  {
    id: 'hs-broken',
    panorama_id: 'pano-1',
    kind: 'poi',
    yaw_deg: 0,
    pitch_deg: 0,
    poi_id: null,
    target_panorama_id: null,
  },
];

describe('pano hotspot mapping', () => {
  it('maps only the hotspots of the current panorama and drops incomplete ones', () => {
    const configs = buildViewerHotspots({ panorama: panoramas[0], hotspots, pois, panoramas });
    expect(configs.map((config) => config.id)).toEqual(['hs-poi', 'hs-transition']);
  });

  it('normalizes yaw into -180..180 and clamps pitch', () => {
    const configs = buildViewerHotspots({ panorama: panoramas[0], hotspots, pois, panoramas });
    const transition = configs.find((config) => config.id === 'hs-transition');
    expect(transition?.yaw).toBeCloseTo(-170, 5);
    expect(configs[0].pitch).toBe(-10);
    expect(clampHotspotAngles(370, 120)).toEqual({ yaw: 10, pitch: 89 });
  });

  it('labels POI and transition hotspots from live document data', () => {
    expect(hotspotLabel(hotspots[0], pois, panoramas)).toBe('Стенд ТТК');
    expect(hotspotLabel(hotspots[1], pois, panoramas)).toBe('Переход: Коридор');
    const orphan: Hotspot = { ...hotspots[1], target_panorama_id: 'gone' };
    expect(hotspotLabel(orphan, pois, panoramas)).toBe('Переход к панораме');
  });

  it('reports activation with typed arguments for Pannellum click handlers', () => {
    const onActivate = vi.fn();
    const configs = buildViewerHotspots({ panorama: panoramas[0], hotspots, pois, panoramas, onActivate });

    configs[0].clickHandlerFunc({}, configs[0].clickHandlerArgs);
    configs[1].clickHandlerFunc({}, configs[1].clickHandlerArgs);

    expect(onActivate).toHaveBeenNthCalledWith(1, { kind: 'poi', poiId: 'poi-1' }, expect.objectContaining({ id: 'hs-poi' }));
    expect(onActivate).toHaveBeenNthCalledWith(
      2,
      { kind: 'transition', panoramaId: 'pano-2' },
      expect.objectContaining({ id: 'hs-transition' }),
    );
  });

  it('renders tooltip labels as text, not markup', () => {
    const configs = buildViewerHotspots({
      panorama: panoramas[0],
      hotspots: [{ ...hotspots[0], id: 'hs-x' }],
      pois: [{ ...pois[0], title: '<img src=x onerror=alert(1)>' }],
      panoramas,
    });
    const host = document.createElement('div');
    configs[0].createTooltipFunc(host, configs[0].createTooltipArgs);
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img src=x');
  });

  it('derives pitch limits from measured sphere coverage', () => {
    const full: AssetRef = {
      id: 'a',
      kind: 'panorama',
      source: 'stitch',
      width_px: 4096,
      height_px: 2048,
      projection: 'equirectangular',
      haov_deg: 360,
      vaov_deg: 180,
      v_offset_deg: 0,
      preview_url: 'p',
      mobile_url: 'm',
      full_url: 'f',
      created_at: '',
    };
    expect(pitchBounds(full)).toEqual({ minPitch: -85, maxPitch: 85 });
    expect(pitchBounds({ ...full, vaov_deg: 120, v_offset_deg: -10 })).toEqual({ minPitch: -70, maxPitch: 50 });
    expect(pitchBounds(null)).toEqual({ minPitch: -85, maxPitch: 85 });
  });

  it('counts hotspots whose targets were deleted', () => {
    expect(countDanglingHotspots(hotspots, pois, panoramas)).toBe(1);
  });

  it('clamps field of view to a usable range', () => {
    expect(clampHfov(10)).toBe(40);
    expect(clampHfov(400)).toBe(130);
    expect(clampHfov(Number.NaN)).toBe(100);
  });
});
