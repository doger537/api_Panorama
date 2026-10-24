import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AssetRef,
  MapDocument,
  OrganizerMap,
} from "../../../../CONTRACTS/types";
import { ApiClientError, apiClient } from "../../shared/api";
import { guardNavigation } from "../../shared/router";

export function useWorkspace(mapId: string) {
  const [map, setMap] = useState<OrganizerMap | null>(null);
  const [draft, setDraft] = useState<MapDocument | null>(null);
  const [assets, setAssets] = useState<AssetRef[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const alive = useRef(true);
  const busy = useRef(false);
  const draftRef = useRef(draft);
  const etag = useRef("");
  const loadSequence = useRef(0);
  draftRef.current = draft;
  const dirty = Boolean(
    map &&
      draft &&
      JSON.stringify(draft) !== JSON.stringify(map.snapshot.document),
  );

  const change = useCallback((next: MapDocument) => {
    draftRef.current = next;
    setDraft(next);
  }, []);
  const reload = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const result = await apiClient.getMap(mapId);
      if (!alive.current || sequence !== loadSequence.current) return;
      setMap(result.map);
      change(result.map.snapshot.document);
      etag.current = result.etag;
      setAssets(result.map.snapshot.assets);
      setConflict(false);
      setError(null);
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Не удалось загрузить карту");
    }
  }, [mapId, change]);
  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
      loadSequence.current += 1;
    };
  }, [reload]);
  useEffect(() => {
    if (!dirty) return;
    const removeGuard = guardNavigation(() => window.confirm("Есть несохранённые изменения. Покинуть карту?"));
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => {
      removeGuard();
      window.removeEventListener("beforeunload", guard);
    };
  }, [dirty]);

  const save = async (published?: boolean) => {
    if (!draftRef.current || busy.current || conflict) return false;
    const original = draftRef.current;
    const submitted = {
      ...original,
      ...(published === undefined ? {} : { is_published: published }),
    };
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await apiClient.replaceMapDocument(
        mapId,
        submitted,
        etag.current,
      );
      if (!alive.current) return false;
      setMap(result.map);
      etag.current = result.etag;
      // Keep changes typed while the request was in flight. Publication follows the confirmed save.
      change(
        draftRef.current === original
          ? result.map.snapshot.document
          : {
              ...draftRef.current!,
              is_published: result.map.snapshot.document.is_published,
            },
      );
      setAssets((current) => [
        ...current.filter(
          (a) => !result.map.snapshot.assets.some((b) => b.id === a.id),
        ),
        ...result.map.snapshot.assets,
      ]);
      return true;
    } catch (e) {
      if (alive.current) {
        setConflict(e instanceof ApiClientError && e.status === 412);
        setError(e instanceof Error ? e.message : "Не удалось сохранить карту");
      }
      return false;
    } finally {
      if (alive.current) {
        busy.current = false;
        setSaving(false);
      }
    }
  };
  const addAsset = (asset: AssetRef) =>
    setAssets((current) => [
      ...current.filter((a) => a.id !== asset.id),
      asset,
    ]);
  return {
    map,
    draft,
    assets,
    dirty,
    saving,
    error,
    conflict,
    change,
    reload,
    save,
    addAsset,
  };
}
