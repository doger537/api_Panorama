import type { MapDocument, Point, Shape } from "../../../../CONTRACTS/types";
export type Selection = {
  kind: "shapes" | "pois" | "nodes" | "edges" | "panoramas";
  id: string;
} | null;

export function removeSelection(
  doc: MapDocument,
  selection: NonNullable<Selection>,
): MapDocument {
  const { kind, id } = selection;
  const next = { ...doc, [kind]: doc[kind].filter((item) => item.id !== id) };
  if (kind === "nodes") {
    next.edges = doc.edges.filter((edge) => edge.a !== id && edge.b !== id);
    next.pois = doc.pois.map((poi) =>
      poi.nav_node_id === id ? { ...poi, nav_node_id: null } : poi,
    );
    next.panoramas = doc.panoramas.map((pano) =>
      pano.nav_node_id === id ? { ...pano, nav_node_id: null } : pano,
    );
  }
  if (kind === "pois")
    next.hotspots = doc.hotspots.filter((h) => h.poi_id !== id);
  if (kind === "panoramas")
    next.hotspots = doc.hotspots.filter(
      (h) => h.panorama_id !== id && h.target_panorama_id !== id,
    );
  return next;
}

export function connectNodes(
  doc: MapDocument,
  first: string,
  second: string,
): MapDocument {
  if (!first || !second || first === second)
    throw new Error("Выберите два разных узла");
  const [a, b] = [first, second].sort();
  if (doc.edges.some((edge) => edge.a === a && edge.b === b))
    throw new Error("Эти узлы уже соединены");
  const source = doc.nodes.find((n) => n.id === a),
    target = doc.nodes.find((n) => n.id === b);
  if (!source || !target || (source.x === target.x && source.y === target.y))
    throw new Error("Узлы должны существовать и иметь разные координаты");
  return { ...doc, edges: [...doc.edges, { id: crypto.randomUUID(), a, b }] };
}

export function moveSelection(
  doc: MapDocument,
  selection: NonNullable<Selection>,
  delta: Point,
  width: number,
  height: number,
): MapDocument {
  if (selection.kind === "edges") return doc;
  const items = doc[selection.kind];
  const item = items.find((entry) => entry.id === selection.id);
  if (!item) return doc;
  const points = "points" in item ? item.points : [item];
  const dx = Math.max(
    -Math.min(...points.map((p) => p.x)),
    Math.min(delta.x, width - Math.max(...points.map((p) => p.x))),
  );
  const dy = Math.max(
    -Math.min(...points.map((p) => p.y)),
    Math.min(delta.y, height - Math.max(...points.map((p) => p.y))),
  );
  const moved =
    "points" in item
      ? {
          ...item,
          points: item.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        }
      : { ...item, x: item.x + dx, y: item.y + dy };
  return {
    ...doc,
    [selection.kind]: items.map((entry) =>
      entry.id === item.id ? moved : entry,
    ),
  };
}

export function makeShape(kind: Shape["kind"], points: Point[]): Shape {
  if (points.length < (kind === "wall" ? 2 : 3))
    throw new Error("Недостаточно вершин");
  return { id: crypto.randomUUID(), kind, label: "", points };
}
