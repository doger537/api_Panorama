import type { AssetRef, Panorama } from '../../../../CONTRACTS/types';

export type MediaVariant = 'preview' | 'mobile' | 'full';

export interface ViewportBudget {
  viewportWidth: number;
  devicePixelRatio: number;
  saveData: boolean;
  effectiveType: string | null;
}

export interface VariantPlan {
  /** Variant requested first so the panorama shows up quickly. */
  initial: MediaVariant;
  /** Variant preloaded in the background and offered as "HQ". */
  highQuality: MediaVariant;
  /** True when the HQ variant should be fetched eagerly after the first frame. */
  preloadHighQuality: boolean;
  reason: 'save-data' | 'slow-connection' | 'small-viewport' | 'desktop';
}

const SLOW_CONNECTIONS = new Set(['slow-2g', '2g']);

export function readViewportBudget(scope: Window | null = typeof window === 'undefined' ? null : window): ViewportBudget {
  if (!scope) {
    return { viewportWidth: 1280, devicePixelRatio: 1, saveData: false, effectiveType: null };
  }
  const connection = (scope.navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  return {
    viewportWidth: scope.innerWidth || 1280,
    devicePixelRatio: scope.devicePixelRatio || 1,
    saveData: Boolean(connection?.saveData),
    effectiveType: connection?.effectiveType ?? null,
  };
}

export function variantUrl(asset: AssetRef | null | undefined, variant: MediaVariant): string | null {
  if (!asset) return null;
  if (variant === 'preview') return asset.preview_url || null;
  if (variant === 'mobile') return asset.mobile_url || null;
  return asset.full_url || null;
}

/**
 * Progressive loading policy: never block the first paint with the full-size sphere.
 * Mobile gets `mobile`, desktop gets `mobile` first as well and upgrades in place.
 */
export function planVariants(budget: ViewportBudget): VariantPlan {
  if (budget.saveData) {
    return { initial: 'preview', highQuality: 'mobile', preloadHighQuality: false, reason: 'save-data' };
  }
  if (budget.effectiveType && SLOW_CONNECTIONS.has(budget.effectiveType)) {
    return { initial: 'preview', highQuality: 'mobile', preloadHighQuality: false, reason: 'slow-connection' };
  }
  if (budget.viewportWidth < 768) {
    return { initial: 'mobile', highQuality: 'full', preloadHighQuality: false, reason: 'small-viewport' };
  }
  return { initial: 'mobile', highQuality: 'full', preloadHighQuality: true, reason: 'desktop' };
}

export function pickPanoramaAsset(panorama: Panorama | null | undefined, assets: AssetRef[]): AssetRef | null {
  if (!panorama) return null;
  const byId = assets.find((asset) => asset.id === panorama.asset_id);
  if (byId) return byId;
  return null;
}

/**
 * Resolves the URL that should be loaded first for a panorama.
 * Falls back to the caller-provided URL when no matching asset is listed,
 * so an organizer preview of an unsaved document still works.
 */
export function resolvePanoramaImage(
  panorama: Panorama | null | undefined,
  assets: AssetRef[],
  fallbackUrl: string,
  budget: ViewportBudget,
): { initialUrl: string; highQualityUrl: string | null; plan: VariantPlan; asset: AssetRef | null } {
  const plan = planVariants(budget);
  const asset = pickPanoramaAsset(panorama, assets);
  const initialUrl = variantUrl(asset, plan.initial) ?? fallbackUrl;
  const highQualityCandidate = variantUrl(asset, plan.highQuality);
  const highQualityUrl = highQualityCandidate && highQualityCandidate !== initialUrl ? highQualityCandidate : null;
  return { initialUrl, highQualityUrl, plan, asset };
}

export function isMediaAvailable(asset: AssetRef | null): boolean {
  return Boolean(asset && (asset.full_url || asset.mobile_url || asset.preview_url));
}

export const VARIANT_LABELS: Record<MediaVariant, string> = {
  preview: 'Превью',
  mobile: 'Мобильная',
  full: 'Полная',
};
