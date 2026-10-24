import { useRef, useState, useEffect, type ReactNode } from "react";
import type {
  AssetRef,
  MapDocument,
  Point,
  Shape,
} from "../../../../CONTRACTS/types";
import { apiClient } from "../../shared/api";
import { pointFromSvg } from "../../shared/coordinates";
import { Inspector, nodeLabel } from "./Inspector";
import {
  connectNodes,
  makeShape,
  moveSelection,
  removeSelection,
  type Selection,
} from "./model";

export interface PlanEditorProps {
  mapId: string | null;
  widthUnits: number;
  heightUnits: number;
  document: MapDocument;
  darkMode?: boolean;
  isAuthenticated: boolean;
  assets?: AssetRef[];
  onChangeDocument: (next: MapDocument) => void;
  onSaveDocument: (next?: MapDocument) => Promise<unknown>;
  onNotify: (message: string) => void;
  onAsset?: (asset: AssetRef) => void;
  captureSlot?: ReactNode;
}
type Tool = "select" | "poi" | "node" | Shape["kind"];
const tools: Record<Tool, string> = {
  select: "Выбрать / переместить",
  poi: "Точка POI",
  node: "Узел прохода",
  wall: "Стена",
  room: "Комната",
  corridor: "Коридор",
};

export function PlanEditor({
  mapId,
  widthUnits: width,
  heightUnits: height,
  document: doc,
  isAuthenticated,
  assets = [],
  onChangeDocument,
  onSaveDocument,
  onNotify,
  onAsset,
  captureSlot,
}: PlanEditorProps) {
  const [tool, setTool] = useState<Tool>("poi");
  const [selection, setSelection] = useState<Selection>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [past, setPast] = useState<MapDocument[]>([]);
  const [future, setFuture] = useState<MapDocument[]>([]);
  const [edgeA, setEdgeA] = useState(""),
    [edgeB, setEdgeB] = useState("");
  const [zoom, setZoom] = useState(1),
    [uploading, setUploading] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const current = useRef(doc);
  current.current = doc;
  const emitted = useRef(doc);
  useEffect(() => {
    if (emitted.current !== doc) { setPast([]); setFuture([]); emitted.current = doc; }
  }, [doc]);
  const emit = (next: MapDocument) => { emitted.current = next; onChangeDocument(next); };
  const drag = useRef<{
    point: Point;
    selection: NonNullable<Selection>;
    document: MapDocument;
  } | null>(null);
  const didDrag = useRef(false);
  const commit = (next: MapDocument) => {
    setPast((history) => [...history.slice(-49), current.current]);
    setFuture([]);
    emit(next);
  };
  const background =
    assets.find((a) => a.id === doc.background_asset_id)?.full_url ??
    (doc.background_asset_id
      ? `/api/v1/media/${doc.background_asset_id}/full`
      : null);
  function click(event: React.MouseEvent<SVGSVGElement>) {
    if (didDrag.current) {
      didDrag.current = false;
      return;
    }
    if (!svg.current || !isAuthenticated) return;
    const raw = pointFromSvg(svg.current, event.clientX, event.clientY);
    const point = {
      x: Math.max(0, Math.min(width, raw.x)),
      y: Math.max(0, Math.min(height, raw.y)),
    };
    if (tool === "select") {
      setSelection(null);
      return;
    }
    if (tool === "poi") {
      const id = crypto.randomUUID(),
        nodeId = crypto.randomUUID();
      commit({
        ...doc,
        nodes: [...doc.nodes, { id: nodeId, ...point }],
        pois: [
          ...doc.pois,
          {
            id,
            title: `Точка ${doc.pois.length + 1}`,
            category: "hall",
            category_label: null,
            description: "",
            ...point,
            nav_node_id: nodeId,
          },
        ],
      });
      setSelection({ kind: "pois", id });
      onNotify("Точка добавлена");
    } else if (tool === "node") {
      const id = crypto.randomUUID();
      commit({ ...doc, nodes: [...doc.nodes, { id, ...point }] });
      setSelection({ kind: "nodes", id });
    } else {
      const next = [...points, point];
      if (tool === "wall" && next.length === 2) {
        commit({ ...doc, shapes: [...doc.shapes, makeShape(tool, next)] });
        setPoints([]);
      } else setPoints(next);
    }
  }
  const selectProps = (kind: NonNullable<Selection>["kind"], id: string) => ({
    onClick: (event: React.MouseEvent) => {
      if (tool !== "select") return;
      event.stopPropagation();
      didDrag.current = false;
      setSelection({ kind, id });
    },
    onPointerDown: (event: React.PointerEvent<SVGGElement>) => {
      if (tool !== "select" || !svg.current) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setSelection({ kind, id });
      didDrag.current = false;
      drag.current = {
        point: pointFromSvg(svg.current, event.clientX, event.clientY),
        selection: { kind, id },
        document: doc,
      };
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (!drag.current || !svg.current) return;
      const next = pointFromSvg(svg.current, event.clientX, event.clientY);
      const delta = {
        x: next.x - drag.current.point.x,
        y: next.y - drag.current.point.y,
      };
      if (Math.abs(delta.x) + Math.abs(delta.y) > 0.1) {
        didDrag.current = true;
        emit(
          moveSelection(
            drag.current.document,
            drag.current.selection,
            delta,
            width,
            height,
          ),
        );
      }
    },
    onPointerUp: () => {
      if (drag.current && didDrag.current) {
        const before = drag.current.document;
        setPast((history) => [...history.slice(-49), before]);
        setFuture([]);
      }
      drag.current = null;
    },
    onPointerCancel: () => {
      if (drag.current) emit(drag.current.document);
      drag.current = null;
    },
  });
  return (
    <section className="plan-editor">
      <h2>Редактор плана</h2>
      <div className="toolbar">
        {Object.entries(tools).map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={tool === value}
            onClick={() => {
              setTool(value as Tool);
              setPoints([]);
            }}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          disabled={!past.length}
          onClick={() => {
            const previous = past[past.length - 1];
            setPast(past.slice(0, -1));
            setFuture([doc, ...future]);
            emit(previous);
          }}
        >
          Отменить правку
        </button>
        <button
          type="button"
          disabled={!future.length}
          onClick={() => {
            setPast([...past, doc]);
            emit(future[0]);
            setFuture(future.slice(1));
          }}
        >
          Повторить правку
        </button>
        <button type="button" onClick={() => void onSaveDocument()}>
          Сохранить
        </button>
      </div>
      <label>
        Импорт плана (PNG, JPEG, WebP)
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={uploading || !isAuthenticated}
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file || !mapId) return;
            setUploading(true);
            try {
              const asset = await apiClient.uploadAsset(mapId, {
                kind: "plan",
                file,
              });
              onAsset?.(asset);
              commit({ ...current.current, background_asset_id: asset.id });
            } catch (e) {
              onNotify(e instanceof Error ? e.message : "Ошибка импорта");
            } finally {
              setUploading(false);
            }
          }}
        />
      </label>
      <div className="toolbar">
        <label>
          Масштаб
          <input
            type="range"
            min={1}
            max={3}
            step={0.25}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        {(tool === "room" || tool === "corridor") && (
          <button
            type="button"
            disabled={points.length < 3}
            onClick={() => {
              commit({
                ...doc,
                shapes: [...doc.shapes, makeShape(tool, points)],
              });
              setPoints([]);
            }}
          >
            Завершить фигуру
          </button>
        )}
        {!!points.length && (
          <button type="button" onClick={() => setPoints([])}>
            Сбросить вершины
          </button>
        )}
      </div>
      <div className="plan-scroll">
        <svg
          ref={svg}
          data-testid="plan-canvas"
          role="img"
          aria-label="Редактируемый план"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          style={{
            width: `${zoom * 100}%`,
            aspectRatio: `${width} / ${height}`,
            touchAction: tool === "select" ? "none" : "manipulation",
          }}
          onClick={click}
        >
          {background && (
            <image
              href={background}
              width={width}
              height={height}
              preserveAspectRatio="none"
            />
          )}
          {doc.shapes.map((shape) => (
            <g key={shape.id} {...selectProps("shapes", shape.id)}>
              {shape.kind === "wall" ? (
                <polyline
                  points={shape.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke="#475569"
                  strokeWidth={3}
                />
              ) : (
                <polygon
                  points={shape.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill={shape.kind === "room" ? "#fecaca66" : "#bfdbfe66"}
                  stroke="#64748b"
                  strokeWidth={2}
                />
              )}
              <title>{shape.label || shape.kind}</title>
            </g>
          ))}
          {doc.edges.map((edge) => {
            const a = doc.nodes.find((n) => n.id === edge.a),
              b = doc.nodes.find((n) => n.id === edge.b);
            return a && b ? (
              <g key={edge.id} {...selectProps("edges", edge.id)}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="#0284c7"
                  strokeWidth={4}
                />
              </g>
            ) : null;
          })}
          {doc.nodes.map((node) => (
            <g key={node.id} {...selectProps("nodes", node.id)}>
              <circle cx={node.x} cy={node.y} r={5} fill="#0369a1" />
            </g>
          ))}
          {doc.pois.map((poi) => (
            <g key={poi.id} {...selectProps("pois", poi.id)}>
              <circle cx={poi.x} cy={poi.y} r={9} fill="#e31b23" />
              <text x={poi.x + 12} y={poi.y} fontSize={12}>
                {poi.title}
              </text>
            </g>
          ))}
          {doc.panoramas.map((p) => (
            <g key={p.id} {...selectProps("panoramas", p.id)}>
              <rect
                x={p.x - 6}
                y={p.y - 6}
                width={12}
                height={12}
                fill="#7c3aed"
              />
              <title>{p.title}</title>
            </g>
          ))}
          {points.length > 0 && (
            <polyline
              points={points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="#e31b23"
              strokeWidth={2}
            />
          )}
        </svg>
      </div>
      <div className="editor-details">
        <section>
          <h3>Объекты</h3>
          <select
            aria-label="Выбранный объект"
            value={selection ? `${selection.kind}:${selection.id}` : ""}
            onChange={(e) => {
              const [kind, id] = e.target.value.split(":");
              setSelection(
                id
                  ? { kind: kind as NonNullable<Selection>["kind"], id }
                  : null,
              );
            }}
          >
            <option value="">Выберите объект</option>
            {(
              ["shapes", "pois", "nodes", "edges", "panoramas"] as const
            ).flatMap((kind) =>
              doc[kind].map((item, i) => (
                <option key={item.id} value={`${kind}:${item.id}`}>
                  {"title" in item
                    ? item.title
                    : "label" in item
                      ? item.label || `${kind} ${i + 1}`
                      : `${kind} ${i + 1}`}
                </option>
              )),
            )}
          </select>
          <button
            type="button"
            disabled={!selection}
            onClick={() => {
              if (selection) commit(removeSelection(doc, selection));
              setSelection(null);
            }}
          >
            Удалить объект
          </button>
          <h3>Проход между узлами</h3>
          {(
            [
              ["От узла", edgeA, setEdgeA],
              ["К узлу", edgeB, setEdgeB],
            ] as const
          ).map(([label, value, setter]) => (
            <label key={label}>
              {label}
              <select value={value} onChange={(e) => setter(e.target.value)}>
                <option value="">Выберите узел</option>
                {doc.nodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {nodeLabel(doc, node.id)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <button
            type="button"
            onClick={() => {
              try {
                commit(connectNodes(doc, edgeA, edgeB));
              } catch (e) {
                onNotify((e as Error).message);
              }
            }}
          >
            Добавить проход
          </button>
        </section>
        {selection && (
          <Inspector
            doc={doc}
            selection={selection}
            width={width}
            height={height}
            change={commit}
          />
        )}
      </div>
      {captureSlot}
    </section>
  );
}
