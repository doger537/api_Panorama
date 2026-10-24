import { useEffect, useState } from "react";
import type { MapSummary } from "../../../../CONTRACTS/types";
import { apiClient } from "../../shared/api";
import { navigate } from "../../shared/router";

export function MapList() {
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [title, setTitle] = useState("");
  const [width, setWidth] = useState(700);
  const [height, setHeight] = useState(500);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    void apiClient
      .listMaps()
      .then((items) => {
        if (!disposed) setMaps(items);
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    return () => {
      disposed = true;
    };
  }, []);
  return (
    <main className="workspace">
      <h1>Мои карты</h1>
      {error && <p role="alert">{error}</p>}
      <form
        className="toolbar"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          try {
            const result = await apiClient.createMap({
              title,
              description: "",
              width_units: width,
              height_units: height,
              scale_m_per_unit: null,
              max_walk_gap_units: 500,
            });
            navigate(`/organize/${result.map.snapshot.id}`);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Ошибка создания");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Название карты
          <input
            required
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Ширина
          <input
            type="number"
            min={1}
            max={100000}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
        </label>
        <label>
          Высота
          <input
            type="number"
            min={1}
            max={100000}
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
          />
        </label>
        <button disabled={busy}>Создать карту</button>
      </form>
      <ul className="map-list">
        {maps.map((map) => (
          <li key={map.id}>
            <a href={`/organize/${map.id}`}>{map.title}</a>
            <span>
              {map.is_published ? "Опубликована" : "Черновик"} · v{map.revision}
            </span>
          </li>
        ))}
      </ul>
      {!maps.length && <p>Создайте первую карту, чтобы начать разметку.</p>}
    </main>
  );
}
