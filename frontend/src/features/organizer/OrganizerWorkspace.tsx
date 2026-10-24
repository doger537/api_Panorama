import { useRef, useState } from "react";
import type {
  AssetRef,
  Hotspot,
  MapDocument,
  Panorama,
} from "../../../../CONTRACTS/types";
import { PlanEditor } from "../plan";
import { CaptureGuide } from "../capture";
import { PanoramaViewer } from "../panorama";
import { useWorkspace } from "./useWorkspace";
import { iframeCode } from "./share";

export function OrganizerWorkspace({ mapId }: { mapId: string }) {
  const ws = useWorkspace(mapId);
  const latest = useRef(ws.draft);
  latest.current = ws.draft;
  const [notice, setNotice] = useState("");
  const [panoramaId, setPanoramaId] = useState("");
  const [viewerOpen, setViewerOpen] = useState(false);
  if (!ws.map || !ws.draft)
    return (
      <main className="workspace">
        <p role={ws.error ? "alert" : "status"}>
          {ws.error || "Загружаем карту…"}
        </p>
        <button onClick={() => void ws.reload()}>Повторить загрузку</button>
      </main>
    );
  const doc = ws.draft,
    map = ws.map.snapshot;
  const selectedPano =
    doc.panoramas.find((p) => p.id === panoramaId) ?? doc.panoramas[0] ?? null;
  const edit = (update: (current: MapDocument) => MapDocument) => {
    if (latest.current) ws.change(update(latest.current));
  };
  const readyPanorama = (
    asset: AssetRef,
    title: string,
    x: number,
    y: number,
  ) => {
    ws.addAsset(asset);
    edit((current) => {
      if (current.panoramas.some((p) => p.asset_id === asset.id))
        return current;
      const node = [...current.nodes]
        .filter((n) => !current.panoramas.some((p) => p.nav_node_id === n.id))
        .sort(
          (a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y),
        )[0];
      const panorama: Panorama = {
        id: crypto.randomUUID(),
        asset_id: asset.id,
        title,
        x,
        y,
        nav_node_id: node?.id ?? null,
        heading_offset_deg: 0,
      };
      setPanoramaId(panorama.id);
      return { ...current, panoramas: [...current.panoramas, panorama] };
    });
  };
  return (
    <main className="workspace">
      <h1>{doc.title}</h1>
      <div className="toolbar">
        <label>
          Название карты
          <input
            maxLength={160}
            value={doc.title}
            onChange={(e) => ws.change({ ...doc, title: e.target.value })}
          />
        </label>
        <label>
          Описание карты
          <textarea
            maxLength={4000}
            value={doc.description}
            onChange={(e) => ws.change({ ...doc, description: e.target.value })}
          />
        </label>
        <label>
          Метров на единицу
          <input
            type="number"
            min={0.0001}
            max={1000}
            step="any"
            value={doc.scale_m_per_unit ?? ""}
            onChange={(e) =>
              ws.change({
                ...doc,
                scale_m_per_unit: e.target.value
                  ? Number(e.target.value)
                  : null,
              })
            }
          />
        </label>
        <label>
          Максимальный шаг walkthrough
          <input
            type="number"
            min={1}
            max={1000000}
            value={doc.max_walk_gap_units}
            onChange={(e) =>
              ws.change({ ...doc, max_walk_gap_units: Number(e.target.value) })
            }
          />
        </label>
        <button
          disabled={ws.saving || ws.conflict}
          onClick={() => void ws.save()}
        >
          {ws.saving ? "Сохранение…" : "Сохранить карту"}
        </button>
        <button
          disabled={ws.saving || ws.conflict}
          onClick={() => void ws.save(!map.document.is_published)}
        >
          {map.document.is_published ? "Снять с публикации" : "Опубликовать"}
        </button>
        <span role="status">
          {ws.dirty
            ? "Есть несохранённые изменения"
            : `Сохранено · v${map.revision}`}
        </span>
      </div>
      {ws.error && <p role="alert">{ws.error}</p>}
      {!doc.background_asset_id && !doc.shapes.length && <p role="status">План пока пуст: импортируйте изображение или нарисуйте помещения.</p>}
      {(!doc.edges.length || doc.pois.some((poi) => !poi.nav_node_id)) && <p role="status">Для навигации привяжите точки к узлам и соедините узлы проходами.</p>}
      {ws.conflict && (
        <section role="alert">
          <p>
            Карта изменена в другой вкладке. Ваши правки сохранены в редакторе;
            автоматическая перезапись остановлена.
          </p>
          <button
            onClick={() => {
              const link = document.createElement("a");
              link.href = URL.createObjectURL(
                new Blob([JSON.stringify(doc, null, 2)], {
                  type: "application/json",
                }),
              );
              link.download = "local-draft.json";
              link.click();
              URL.revokeObjectURL(link.href);
            }}
          >
            Скачать локальные правки
          </button>
          <button
            onClick={() => {
              if (
                window.confirm("Заменить локальные правки версией с сервера?")
              )
                void ws.reload();
            }}
          >
            Загрузить серверную версию
          </button>
        </section>
      )}
      {notice && <p role="status">{notice}</p>}
      <details>
        <summary>Публичная ссылка и встраивание</summary>
        <a href={`/m/${map.slug}`} target="_blank" rel="noreferrer">
          Открыть опубликованную карту
        </a>
        <label>
          Код iframe
          <textarea
            readOnly
            value={iframeCode(window.location.origin, map.slug, doc.title)}
          />
        </label>
        {!map.document.is_published && (
          <p>Ссылка станет доступна после публикации.</p>
        )}
      </details>
      <PlanEditor
        key={mapId}
        mapId={mapId}
        widthUnits={map.width_units}
        heightUnits={map.height_units}
        document={doc}
        assets={ws.assets}
        isAuthenticated
        onChangeDocument={ws.change}
        onAsset={ws.addAsset}
        onNotify={setNotice}
        onSaveDocument={() => ws.save()}
        captureSlot={
          <CaptureGuide
            mapId={mapId}
            isAuthenticated
            onNotify={setNotice}
            onPanoramaAssetReady={readyPanorama}
            mapDocument={doc}
            widthUnits={map.width_units}
            heightUnits={map.height_units}
          />
        }
      />
      <section>
        <h2>Панорамы и хотспоты</h2>
        <p>
          Положение, узел маршрута и направление редактируются в свойствах
          объекта на плане.
        </p>
        <label>
          Панорама
          <select
            value={selectedPano?.id ?? ""}
            onChange={(e) => setPanoramaId(e.target.value)}
          >
            <option value="">Выберите панораму</option>
            {doc.panoramas.map((p) => (
              <option value={p.id} key={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <button disabled={!selectedPano} onClick={() => setViewerOpen(true)}>
          Редактировать хотспоты
        </button>
      </section>
      <PanoramaViewer
        isOpen={viewerOpen}
        onClose={() => setViewerOpen(false)}
        title={selectedPano?.title ?? ""}
        imageUrl={
          selectedPano ? `/api/v1/media/${selectedPano.asset_id}/mobile` : ""
        }
        panorama={selectedPano}
        panoramas={doc.panoramas}
        hotspots={doc.hotspots}
        pois={doc.pois}
        assets={ws.assets}
        editable
        onSelectPanorama={setPanoramaId}
        onAddHotspot={(hotspot: Omit<Hotspot, "id">) =>
          edit((current) => ({
            ...current,
            hotspots: [
              ...current.hotspots.filter(
                (h) =>
                  !(
                    h.panorama_id === hotspot.panorama_id &&
                    h.kind === hotspot.kind &&
                    h.poi_id === hotspot.poi_id &&
                    h.target_panorama_id === hotspot.target_panorama_id
                  ),
              ),
              { ...hotspot, id: crypto.randomUUID() },
            ],
          }))
        }
        onDeleteHotspot={(id) =>
          edit((current) => ({
            ...current,
            hotspots: current.hotspots.filter((h) => h.id !== id),
          }))
        }
      />
    </main>
  );
}
