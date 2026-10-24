import { describe, it, expect } from 'vitest';
import { snapshot } from './visitorTestData';
import {
  buildVisitorModel,
  categoryIcon,
  categoryLabel,
  filterPois,
  findPanorama,
  findPoi,
  formatDistance,
  nearestNodeId,
  routeEndpoints,
  routeNodeForPoi,
} from './model';

describe('visitor model', () => {
  it('exposes any published slug, not a hardcoded catalogue', () => {
    const model = buildVisitorModel(snapshot);
    expect(model.slug).toBe('ttk-any-published-slug');
    expect(model.title).toBe('ТТК Экспо');
    expect(model.revision).toBe(7);
  });

  it('resolves the uploaded plan background for the visitor', () => {
    expect(buildVisitorModel(snapshot).backgroundUrl).toBe('/media/plan/mobile');
    const withoutBackground = buildVisitorModel({
      ...snapshot,
      document: { ...snapshot.document, background_asset_id: null },
    });
    expect(withoutBackground.backgroundUrl).toBeNull();
  });

  it('links POIs to panoramas through the navigation graph', () => {
    const model = buildVisitorModel(snapshot);
    expect(model.pois[0].panoramaId).toBe('pano-1');
    expect(model.pois[1].panoramaId).toBeNull();
    expect(model.panoramas[0].asset?.id).toBe('asset-pano');
    expect(model.panoramas[0].hotspotCount).toBe(1);
  });

  it('groups POIs by category with custom labels', () => {
    const model = buildVisitorModel(snapshot);
    expect(model.categories.map((item) => `${item.id}:${item.count}`)).toEqual(
      expect.arrayContaining(['booth:1', 'wifi:1', 'custom:1']),
    );
    expect(categoryLabel(snapshot.document.pois[2])).toBe('Зона отдыха');
    expect(categoryLabel(snapshot.document.pois[0])).toBe('Стенд');
    expect(categoryIcon(snapshot.document.pois[1])).toBe('wifi');
  });

  it('filters by text and category', () => {
    const model = buildVisitorModel(snapshot);
    expect(filterPois(model, { query: 'wi-fi' }).map((poi) => poi.id)).toEqual(['poi-2']);
    expect(filterPois(model, { query: 'ttk_guest' }).map((poi) => poi.id)).toEqual(['poi-2']);
    expect(filterPois(model, { category: 'booth' }).map((poi) => poi.id)).toEqual(['poi-1']);
    expect(filterPois(model, { category: 'all', query: '' })).toHaveLength(3);
  });

  it('snaps POIs without a node to the closest navigation node', () => {
    const model = buildVisitorModel(snapshot);
    expect(nearestNodeId(model, 295, 105)).toBe('node-2');
    expect(routeNodeForPoi(model, model.pois[1])).toBe('node-2');
    expect(routeNodeForPoi(model, model.pois[0])).toBe('node-1');
  });

  it('builds route endpoints only for routable POIs', () => {
    const model = buildVisitorModel(snapshot);
    const endpoints = routeEndpoints(model);
    expect(endpoints).toHaveLength(3);
    expect(endpoints[1]).toMatchObject({ label: 'Wi-Fi зона', nodeId: 'node-2', poiId: 'poi-2' });
  });

  it('formats distance using the map scale', () => {
    const model = buildVisitorModel(snapshot);
    expect(formatDistance(model, 200)).toBe('10.0 м');
    expect(formatDistance({ ...model, scaleMPerUnit: null }, 200)).toBe('200 ед.');
  });

  it('finds selections defensively', () => {
    const model = buildVisitorModel(snapshot);
    expect(findPoi(model, 'poi-3')?.title).toBe('Лаунж');
    expect(findPoi(model, null)).toBeNull();
    expect(findPanorama(model, 'pano-1')?.title).toBe('Панорама входа');
    expect(findPanorama(model, 'nope')).toBeNull();
  });
});
