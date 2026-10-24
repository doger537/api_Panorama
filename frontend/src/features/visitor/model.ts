import type {
  AssetRef,
  Hotspot,
  MapDocument,
  NavEdge,
  NavNode,
  Panorama,
  Poi,
  PublicMap,
  Shape,
  UUID,
} from '../../../../CONTRACTS/types';

export interface VisitorPoi {
  id: UUID;
  title: string;
  category: Poi['category'];
  categoryLabel: string;
  description: string;
  x: number;
  y: number;
  navNodeId: UUID | null;
  panoramaId: UUID | null;
}

export interface VisitorPanorama {
  id: UUID;
  title: string;
  x: number;
  y: number;
  navNodeId: UUID | null;
  asset: AssetRef | null;
  hotspotCount: number;
}

export interface VisitorCategory {
  id: Poi['category'];
  label: string;
  count: number;
}

export interface VisitorModel {
  slug: string;
  revision: number;
  title: string;
  description: string;
  widthUnits: number;
  heightUnits: number;
  scaleMPerUnit: number | null;
  updatedAt: string;
  backgroundUrl: string | null;
  shapes: Shape[];
  nodes: NavNode[];
  edges: NavEdge[];
  hotspots: Hotspot[];
  pois: VisitorPoi[];
  panoramas: VisitorPanorama[];
  categories: VisitorCategory[];
  stats: { poiCount: number; panoramaCount: number; routeEdges: number };
}

export const CATEGORY_META: Record<Poi['category'], { label: string; icon: string }> = {
  booth: { label: 'Стенд', icon: 'presentation' },
  hall: { label: 'Зал', icon: 'users' },
  entrance: { label: 'Вход', icon: 'door-open' },
  service_desk: { label: 'Стойка', icon: 'shield-check' },
  wifi: { label: 'Wi-Fi', icon: 'wifi' },
  custom: { label: 'Другое', icon: 'map' },
};

export function categoryLabel(poi: Pick<Poi, 'category' | 'category_label'>): string {
  return poi.category_label?.trim() || CATEGORY_META[poi.category]?.label || 'Объект';
}

export function categoryIcon(poi: Pick<Poi, 'category'>): string {
  return CATEGORY_META[poi.category]?.icon || 'map';
}

function backgroundUrlFor(document: MapDocument, assets: AssetRef[]): string | null {
  if (!document.background_asset_id) return null;
  const asset = assets.find((item) => item.id === document.background_asset_id);
  if (!asset) return null;
  return asset.mobile_url || asset.full_url || asset.preview_url || null;
}

/** Builds everything the visitor screen needs from a published snapshot. */
export function buildVisitorModel(snapshot: PublicMap): VisitorModel {
  const document = snapshot.document;
  const assets = snapshot.assets ?? [];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));

  const panoramaByNode = new Map<UUID, Panorama>();
  for (const panorama of document.panoramas) {
    if (panorama.nav_node_id) panoramaByNode.set(panorama.nav_node_id, panorama);
  }

  const pois: VisitorPoi[] = document.pois.map((poi) => {
    const panorama = poi.nav_node_id ? panoramaByNode.get(poi.nav_node_id) : undefined;
    return {
      id: poi.id,
      title: poi.title,
      category: poi.category,
      categoryLabel: categoryLabel(poi),
      description: poi.description,
      x: poi.x,
      y: poi.y,
      navNodeId: poi.nav_node_id,
      panoramaId: panorama?.id ?? null,
    };
  });

  const panoramas: VisitorPanorama[] = document.panoramas.map((panorama) => ({
    id: panorama.id,
    title: panorama.title,
    x: panorama.x,
    y: panorama.y,
    navNodeId: panorama.nav_node_id,
    asset: assetById.get(panorama.asset_id) ?? null,
    hotspotCount: document.hotspots.filter((hotspot) => hotspot.panorama_id === panorama.id).length,
  }));

  const counts = new Map<Poi['category'], number>();
  for (const poi of document.pois) {
    counts.set(poi.category, (counts.get(poi.category) ?? 0) + 1);
  }
  const categories: VisitorCategory[] = Array.from(counts.entries())
    .map(([id, count]) => ({ id, label: CATEGORY_META[id]?.label ?? 'Другое', count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    slug: snapshot.slug,
    revision: snapshot.revision,
    title: document.title || 'Карта пространства',
    description: document.description,
    widthUnits: snapshot.width_units,
    heightUnits: snapshot.height_units,
    scaleMPerUnit: document.scale_m_per_unit,
    updatedAt: snapshot.updated_at,
    backgroundUrl: backgroundUrlFor(document, assets),
    shapes: document.shapes,
    nodes: document.nodes,
    edges: document.edges,
    hotspots: document.hotspots,
    pois,
    panoramas,
    categories,
    stats: {
      poiCount: pois.length,
      panoramaCount: panoramas.length,
      routeEdges: document.edges.length,
    },
  };
}

export function filterPois(
  model: VisitorModel,
  filter: { query?: string; category?: Poi['category'] | 'all' },
): VisitorPoi[] {
  const query = (filter.query ?? '').trim().toLowerCase();
  const category = filter.category ?? 'all';
  return model.pois.filter((poi) => {
    if (category !== 'all' && poi.category !== category) return false;
    if (!query) return true;
    return (
      poi.title.toLowerCase().includes(query) ||
      poi.categoryLabel.toLowerCase().includes(query) ||
      poi.description.toLowerCase().includes(query)
    );
  });
}

export function findPoi(model: VisitorModel, poiId: UUID | null): VisitorPoi | null {
  if (!poiId) return null;
  return model.pois.find((poi) => poi.id === poiId) ?? null;
}

export function findPanorama(model: VisitorModel, panoramaId: UUID | null): VisitorPanorama | null {
  if (!panoramaId) return null;
  return model.panoramas.find((panorama) => panorama.id === panoramaId) ?? null;
}

/**
 * POIs are routable when they sit on (or near) the navigation graph.
 * A POI without `nav_node_id` is snapped to the closest node so a visitor can
 * still ask for a route to it.
 */
export function routeNodeForPoi(model: VisitorModel, poi: VisitorPoi): UUID | null {
  if (poi.navNodeId && model.nodes.some((node) => node.id === poi.navNodeId)) return poi.navNodeId;
  return nearestNodeId(model, poi.x, poi.y);
}

export function nearestNodeId(model: VisitorModel, x: number, y: number): UUID | null {
  let best: { id: UUID; distance: number } | null = null;
  for (const node of model.nodes) {
    const distance = Math.hypot(node.x - x, node.y - y);
    if (!best || distance < best.distance) best = { id: node.id, distance };
  }
  return best?.id ?? null;
}

export interface RouteEndpoint {
  key: string;
  label: string;
  nodeId: UUID;
  poiId: UUID | null;
}

export function routeEndpoints(model: VisitorModel): RouteEndpoint[] {
  const endpoints: RouteEndpoint[] = [];
  for (const poi of model.pois) {
    const nodeId = routeNodeForPoi(model, poi);
    if (!nodeId) continue;
    endpoints.push({ key: `poi:${poi.id}`, label: poi.title, nodeId, poiId: poi.id });
  }
  return endpoints;
}

export function formatDistance(model: VisitorModel, distanceUnits: number): string {
  if (model.scaleMPerUnit && model.scaleMPerUnit > 0) {
    return `${(distanceUnits * model.scaleMPerUnit).toFixed(1)} м`;
  }
  return `${Math.round(distanceUnits)} ед.`;
}

export function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
