import type { MapDocument } from '../../../CONTRACTS/types';

export const emptyMapDocument = (title = 'Новая карта'): MapDocument => ({
  title,
  description: '',
  is_published: false,
  scale_m_per_unit: null,
  max_walk_gap_units: 500,
  background_asset_id: null,
  shapes: [],
  nodes: [],
  edges: [],
  pois: [],
  panoramas: [],
  hotspots: [],
});

export function cloneDocument(document: MapDocument): MapDocument {
  return structuredClone(document);
}
