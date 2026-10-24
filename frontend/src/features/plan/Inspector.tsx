import type {
  MapDocument,
  Panorama,
  Poi,
  Shape,
} from "../../../../CONTRACTS/types";
import type { Selection } from "./model";
import { normalizeYaw } from "../../shared/coordinates";

export const categories: Record<Poi["category"], string> = {
  booth: "Стенд",
  hall: "Зал",
  entrance: "Вход",
  service_desk: "Стойка обслуживания",
  wifi: "Wi-Fi",
  custom: "Другое",
};
export function nodeLabel(doc: MapDocument, id: string) {
  const node = doc.nodes.find((n) => n.id === id);
  return (
    doc.pois.find((p) => p.nav_node_id === id)?.title ??
    (node ? `Узел (${Math.round(node.x)}, ${Math.round(node.y)})` : "Нет узла")
  );
}
export function Inspector({
  doc,
  selection,
  width,
  height,
  change,
}: {
  doc: MapDocument;
  selection: NonNullable<Selection>;
  width: number;
  height: number;
  change: (doc: MapDocument) => void;
}) {
  const entity = doc[selection.kind].find((item) => item.id === selection.id);
  if (!entity) return null;
  const patch = (value: object) =>
    change({
      ...doc,
      [selection.kind]: doc[selection.kind].map((item) =>
        item.id === entity.id ? { ...item, ...value } : item,
      ),
    });
  return (
    <section className="inspector">
      <h3>Свойства объекта</h3>
      {"title" in entity && (
        <label>
          Название объекта
          <input
            maxLength={160}
            value={entity.title}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </label>
      )}
      {"label" in entity && (
        <label>
          Название фигуры
          <input
            maxLength={160}
            value={entity.label}
            onChange={(e) => patch({ label: e.target.value })}
          />
        </label>
      )}
      {"x" in entity && (
        <div className="toolbar">
          {(["x", "y"] as const).map((axis) => (
            <label key={axis}>
              {axis.toUpperCase()}
              <input
                type="number"
                min={0}
                max={axis === "x" ? width : height}
                value={entity[axis]}
                onChange={(e) =>
                  patch({
                    [axis]: Math.max(
                      0,
                      Math.min(
                        axis === "x" ? width : height,
                        Number(e.target.value),
                      ),
                    ),
                  })
                }
              />
            </label>
          ))}
        </div>
      )}
      {"category" in entity && (
        <>
          <label>
            Категория
            <select
              value={entity.category}
              onChange={(e) =>
                patch({
                  category: e.target.value,
                  category_label: e.target.value === "custom" ? "Другое" : null,
                })
              }
            >
              {Object.entries(categories).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {entity.category === "custom" && (
            <label>
              Своя категория
              <input
                maxLength={80}
                value={entity.category_label ?? ""}
                onChange={(e) => patch({ category_label: e.target.value })}
              />
            </label>
          )}
          <label>
            Описание
            <textarea
              maxLength={4000}
              value={entity.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </label>
        </>
      )}
      {"nav_node_id" in entity && (
        <label>
          Узел маршрута
          <select
            value={entity.nav_node_id ?? ""}
            onChange={(e) => patch({ nav_node_id: e.target.value || null })}
          >
            <option value="">Не привязан</option>
            {doc.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {nodeLabel(doc, node.id)}
              </option>
            ))}
          </select>
        </label>
      )}
      {"heading_offset_deg" in entity && (
        <label>
          Направление панорамы, °
          <input
            type="number"
            min={-180}
            max={179.9}
            step={0.1}
            value={entity.heading_offset_deg}
            onChange={(e) =>
              patch({
                heading_offset_deg: normalizeYaw(Number(e.target.value)),
              })
            }
          />
        </label>
      )}
      {"points" in entity && (
        <div>
          {entity.points.map((point, index) => (
            <div className="toolbar" key={index}>
              {(["x", "y"] as const).map((axis) => (
                <label key={axis}>
                  Вершина {index + 1}, {axis}
                  <input
                    type="number"
                    min={0}
                    max={axis === "x" ? width : height}
                    value={point[axis]}
                    onChange={(e) =>
                      patch({
                        points: entity.points.map((p, i) =>
                          i === index
                            ? { ...p, [axis]: Number(e.target.value) }
                            : p,
                        ),
                      })
                    }
                  />
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
      {"a" in entity && (
        <p>
          {nodeLabel(doc, entity.a)} → {nodeLabel(doc, entity.b)}
        </p>
      )}
    </section>
  );
}
