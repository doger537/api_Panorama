import { describe, it, expect } from 'vitest';
import type { AssetRef, Panorama } from '../../../../CONTRACTS/types';
import {
  pickPanoramaAsset,
  planVariants,
  readViewportBudget,
  resolvePanoramaImage,
  variantUrl,
} from './media';

const asset: AssetRef = {
  id: 'asset-1',
  kind: 'panorama',
  source: 'stitch',
  width_px: 4096,
  height_px: 2048,
  projection: 'equirectangular',
  haov_deg: 360,
  vaov_deg: 170,
  v_offset_deg: 4,
  preview_url: '/api/v1/media/asset-1/preview',
  mobile_url: '/api/v1/media/asset-1/mobile',
  full_url: '/api/v1/media/asset-1/full',
  created_at: '2026-01-01T00:00:00Z',
};

const panorama: Panorama = {
  id: 'pano-1',
  asset_id: 'asset-1',
  title: 'Зал',
  x: 10,
  y: 20,
  nav_node_id: 'node-1',
  heading_offset_deg: 0,
};

const desktop = { viewportWidth: 1440, devicePixelRatio: 2, saveData: false, effectiveType: '4g' };

describe('panorama media selection', () => {
  it('starts with the mobile variant and upgrades to full on desktop', () => {
    const plan = planVariants(desktop);
    expect(plan).toMatchObject({ initial: 'mobile', highQuality: 'full', preloadHighQuality: true, reason: 'desktop' });
  });

  it('never blocks a phone with the full-size sphere', () => {
    expect(planVariants({ ...desktop, viewportWidth: 390 })).toMatchObject({
      initial: 'mobile',
      highQuality: 'full',
      preloadHighQuality: false,
      reason: 'small-viewport',
    });
  });

  it('respects Data Saver and slow connections', () => {
    expect(planVariants({ ...desktop, saveData: true }).initial).toBe('preview');
    expect(planVariants({ ...desktop, saveData: true }).preloadHighQuality).toBe(false);
    expect(planVariants({ ...desktop, effectiveType: '2g' }).reason).toBe('slow-connection');
  });

  it('maps variants to the contract URLs', () => {
    expect(variantUrl(asset, 'preview')).toBe(asset.preview_url);
    expect(variantUrl(asset, 'mobile')).toBe(asset.mobile_url);
    expect(variantUrl(asset, 'full')).toBe(asset.full_url);
    expect(variantUrl(null, 'full')).toBeNull();
  });

  it('finds only the asset bound to the panorama', () => {
    expect(pickPanoramaAsset(panorama, [asset])?.id).toBe('asset-1');
    const otherPanorama = { ...panorama, asset_id: 'missing' };
    expect(pickPanoramaAsset(otherPanorama, [asset])).toBeNull();
    expect(pickPanoramaAsset(null, [asset])).toBeNull();
  });

  it('resolves the first URL to render and keeps a high quality upgrade path', () => {
    const resolved = resolvePanoramaImage(panorama, [asset], '/fallback.jpg', desktop);
    expect(resolved.initialUrl).toBe(asset.mobile_url);
    expect(resolved.highQualityUrl).toBe(asset.full_url);
    expect(resolved.asset?.id).toBe(asset.id);
  });

  it('falls back to the provided URL when the asset is not listed yet', () => {
    const resolved = resolvePanoramaImage(panorama, [], 'blob:preview', desktop);
    expect(resolved.initialUrl).toBe('blob:preview');
    expect(resolved.highQualityUrl).toBeNull();
    expect(resolved.asset).toBeNull();
  });

  it('reads the viewport budget defensively without a window', () => {
    expect(readViewportBudget(null)).toEqual({
      viewportWidth: 1280,
      devicePixelRatio: 1,
      saveData: false,
      effectiveType: null,
    });
  });
});
