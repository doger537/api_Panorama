import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Poi, RouteResponse } from '../../../../CONTRACTS/types';
import { PanoramaViewer } from '../panorama';
import { ApiClientError, apiClient } from '../../shared/api';
import { Icon } from '../../shared/Icon';
import {
  buildVisitorModel,
  categoryIcon,
  filterPois,
  findPanorama,
  findPoi,
  formatDistance,
  formatUpdatedAt,
  routeEndpoints,
  routeNodeForPoi,
  type VisitorModel,
  type VisitorPanorama,
  type VisitorPoi,
} from './model';
import { PublicPlan } from './PublicPlan';
import { usePublicMap } from './usePublicMap';
import './visitor.css';

export interface PublicSpacePageProps {
  slug: string;
  mode?: 'viewer' | 'embed';
  pollMs?: number;
}

type Notice = { text: string; tone: 'info' | 'error' } | null;

export const PublicSpacePage: React.FC<PublicSpacePageProps> = ({ slug, mode = 'viewer', pollMs }) => {
  const isEmbed = mode === 'embed';
  const { status, snapshot, model, error, revision, liveUpdates, refreshing, refresh } = usePublicMap(slug, {
    live: true,
    pollMs,
  });

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Poi['category'] | 'all'>('all');
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [routeFrom, setRouteFrom] = useState<string>('');
  const [routeTo, setRouteTo] = useState<string>('');
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [notice, setNotice] = useState<Notice>(null);
  const [activePanoramaId, setActivePanoramaId] = useState<string | null>(null);
  const [panoramaYaw, setPanoramaYaw] = useState(0);

  const notify = useCallback((text: string, tone: 'info' | 'error' = 'info') => {
    setNotice({ text, tone });
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Live updates keep the same public link; just confirm that what is on screen
  // is the newest revision.
  useEffect(() => {
    if (liveUpdates > 0 && revision !== null) {
      notify(`Карта обновлена организатором · ревизия ${revision}`);
    }
  }, [liveUpdates, revision, notify]);

  useEffect(() => {
    if (!model) return;
    setRoute(null);
    setSelectedPoiId((prev) => (prev && model.pois.some((poi) => poi.id === prev) ? prev : null));
    setRouteFrom((prev) => (model.pois.some((poi) => poi.id === prev) ? prev : ''));
    setRouteTo((prev) => (model.pois.some((poi) => poi.id === prev) ? prev : ''));
  }, [model?.slug, model?.revision]);

  const visiblePois = useMemo(
    () => (model ? filterPois(model, { query, category }) : []),
    [model, query, category],
  );
  const endpoints = useMemo(() => (model ? routeEndpoints(model) : []), [model]);
  const selectedPoi = model ? findPoi(model, selectedPoiId) : null;
  const routePolylines = route?.polyline ?? null;

  const handleSelectPoi = useCallback((poi: VisitorPoi) => {
    setSelectedPoiId(poi.id);
  }, []);

  const handleRouteTo = useCallback(
    (poi: VisitorPoi) => {
      setSelectedPoiId(poi.id);
      setRouteTo(poi.id);
      if (!routeFrom) {
        const fallback = endpoints.find((endpoint) => endpoint.poiId !== poi.id);
        if (fallback?.poiId) setRouteFrom(fallback.poiId);
      }
    },
    [endpoints, routeFrom],
  );

  const openPanorama = useCallback((panorama: VisitorPanorama, yawDeg = 0) => {
    setActivePanoramaId(panorama.id);
    setPanoramaYaw(yawDeg);
  }, []);

  const openPanoramaForPoi = useCallback(
    (poi: VisitorPoi) => {
      if (!model) return;
      const direct = findPanorama(model, poi.panoramaId);
      const nodeId = routeNodeForPoi(model, poi);
      const byNode = nodeId ? model.panoramas.find((panorama) => panorama.navNodeId === nodeId) : null;
      const target = direct ?? byNode ?? model.panoramas[0] ?? null;
      if (!target) {
        notify('Для этого объекта ещё нет панорамы', 'error');
        return;
      }
      openPanorama(target);
    },
    [model, notify, openPanorama],
  );

  const buildRoute = useCallback(async () => {
    if (!model || !snapshot) return;
    const fromPoi = findPoi(model, routeFrom || null);
    const toPoi = findPoi(model, routeTo || null);
    if (!fromPoi || !toPoi) {
      setRouteError('Выберите точки «Откуда» и «Куда»');
      return;
    }
    const fromNode = routeNodeForPoi(model, fromPoi);
    const toNode = routeNodeForPoi(model, toPoi);
    if (!fromNode || !toNode) {
      setRouteError('У выбранных объектов нет привязки к графу проходов');
      return;
    }
    setRouteBusy(true);
    setRouteError(null);
    try {
      const response = await apiClient.buildRoute(model.slug, {
        revision: snapshot.revision,
        from_node_id: fromNode,
        to_node_id: toNode,
      });
      setRoute(response);
      if (response.walk?.available) {
        notify('Маршрут построен: доступен виртуальный проход по панорамам');
      } else {
        notify('Маршрут построен на плане');
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.status === 409) {
          setRouteError('Карта изменилась. Данные обновлены — постройте маршрут заново.');
          await refresh();
        } else if (err.status === 422) {
          setRouteError('Между этими точками нет связанного прохода');
        } else {
          setRouteError(err.message);
        }
      } else {
        setRouteError('Не удалось построить маршрут');
      }
      setRoute(null);
    } finally {
      setRouteBusy(false);
    }
  }, [model, snapshot, routeFrom, routeTo, refresh, notify]);

  const clearRoute = useCallback(() => {
    setRoute(null);
    setRouteError(null);
  }, []);

  /* ---------------------------- states ---------------------------- */

  if (status === 'loading') {
    return (
      <div className="flex-1 flex items-center justify-center p-8" role="status" aria-live="polite">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 mx-auto rounded-full border-4 border-slate-200 border-t-brand-600 animate-spin" />
          <p className="text-sm text-slate-500">Загружаем карту…</p>
        </div>
      </div>
    );
  }

  if (status === 'not-found' || !model) {
    return (
      <div className="flex-1 flex items-center justify-center p-6" data-testid="public-not-found">
        <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 shadow-xl p-6 text-center space-y-3">
          <Icon name="map" className="w-10 h-10 mx-auto text-brand-600" />
          <h1 className="text-lg font-bold">Карта недоступна</h1>
          <p className="text-sm text-slate-500">
            {error ?? 'Ссылка неверна или организатор снял карту с публикации.'}
          </p>
          <button
            onClick={() => void refresh()}
            className="w-full bg-brand-600 text-white font-semibold py-2.5 rounded-xl text-sm"
          >
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

  /* ---------------------------- live screen ---------------------------- */

  const walk = route?.walk ?? null;
  const selectedPanorama = findPanorama(model, activePanoramaId);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-50" data-testid="public-space-page">
      <div className="ttk-visitor-bar">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 inline-flex items-center gap-1.5 font-extrabold text-brand-600">
            <Icon name="map" className="w-4 h-4" /> ТТК
          </span>
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-bold truncate">{model.title}</h1>
            {!isEmbed && model.description && (
              <p className="text-[11px] text-slate-500 truncate">{model.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="ttk-visitor-live">Live · v{revision}</span>
          {!isEmbed && (
            <span className="text-[11px] text-slate-400 hidden sm:inline">
              {formatUpdatedAt(model.updatedAt)}
            </span>
          )}
          <button
            onClick={() => void refresh()}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
            aria-label="Обновить карту"
            title="Обновить карту"
          >
            <Icon name={refreshing ? 'rotate-3d' : 'share-2'} className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 text-[11px] bg-amber-50 text-amber-800 border-b border-amber-200">
          Нет связи с сервером: показана последняя загруженная ревизия.
        </div>
      )}
      {notice && (
        <div
          className={`px-4 py-2 text-[11px] border-b ${
            notice.tone === 'error'
              ? 'bg-red-50 text-red-700 border-red-200'
              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
          }`}
          role="status"
        >
          {notice.text}
        </div>
      )}

      <div className={`flex-1 min-h-0 flex ${isEmbed ? 'flex-col' : 'flex-col lg:flex-row'}`}>
        {!isEmbed && (
          <aside className="ttk-visitor-panel w-full lg:w-80 xl:w-96 shrink-0 flex flex-col min-h-0 max-h-[46vh] lg:max-h-none overflow-y-auto custom-scrollbar">
            <div className="p-3 space-y-2 border-b border-slate-100">
              <label className="block">
                <span className="sr-only">Поиск объекта</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Найти стенд, зал, Wi-Fi…"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
                />
              </label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className={`ttk-visitor-chip ${category === 'all' ? 'is-active' : ''}`}
                  onClick={() => setCategory('all')}
                >
                  Все · {model.stats.poiCount}
                </button>
                {model.categories.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`ttk-visitor-chip ${category === item.id ? 'is-active' : ''}`}
                    onClick={() => setCategory(item.id)}
                  >
                    {item.label} · {item.count}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-3 space-y-2 border-b border-slate-100 bg-slate-50/60">
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Icon name="route" className="w-3.5 h-3.5 text-brand-600" /> Маршрут
              </h2>
              <select
                value={routeFrom}
                onChange={(event) => setRouteFrom(event.target.value)}
                aria-label="Откуда"
                className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-2 text-xs"
              >
                <option value="">Откуда</option>
                {endpoints.map((endpoint) => (
                  <option key={endpoint.key} value={endpoint.poiId ?? ''}>
                    {endpoint.label}
                  </option>
                ))}
              </select>
              <select
                value={routeTo}
                onChange={(event) => setRouteTo(event.target.value)}
                aria-label="Куда"
                className="w-full bg-white border border-slate-200 rounded-xl px-2.5 py-2 text-xs"
              >
                <option value="">Куда</option>
                {endpoints.map((endpoint) => (
                  <option key={endpoint.key} value={endpoint.poiId ?? ''}>
                    {endpoint.label}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void buildRoute()}
                  disabled={routeBusy || endpoints.length < 2}
                  className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-semibold py-2 rounded-xl text-xs flex items-center justify-center gap-1.5"
                >
                  <Icon name="route" className="w-3.5 h-3.5" /> {routeBusy ? 'Строим…' : 'Построить'}
                </button>
                {route && (
                  <button
                    type="button"
                    onClick={clearRoute}
                    className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-600"
                  >
                    Сброс
                  </button>
                )}
              </div>
              {endpoints.length < 2 && (
                <p className="text-[11px] text-slate-400">
                  Для маршрута нужно минимум два объекта, привязанных к графу проходов.
                </p>
              )}
              {routeError && <p className="text-[11px] text-red-600">{routeError}</p>}

              {route && (
                <div className="rounded-xl bg-white border border-slate-200 p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>Длина маршрута</span>
                    <span className="text-brand-600">{formatDistance(model, route.distance_units)}</span>
                  </div>
                  {walk && walk.available ? (
                    <div className="space-y-1">
                      <p className="text-[11px] font-semibold text-emerald-700">
                        Виртуальный проход: {walk.steps.length} шагов
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {walk.steps.map((step, index) => (
                          <button
                            key={step.node_id}
                            type="button"
                            onClick={() => {
                              const panorama = findPanorama(model, step.panorama_id);
                              if (panorama) openPanorama(panorama, step.yaw_deg);
                            }}
                            className="px-2 py-1 rounded-lg text-[11px] font-bold bg-slate-100 hover:bg-brand-600 hover:text-white"
                            title={`Панорама ${index + 1}`}
                          >
                            {index + 1}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-500">
                      Панорамный проход недоступен
                      {walk && walk.gaps.length > 0 ? `: ${walk.gaps[0].reason}` : ''}
                    </p>
                  )}
                </div>
              )}
            </div>

            <ul className="flex-1 min-h-0 overflow-y-auto custom-scrollbar divide-y divide-slate-100">
              {visiblePois.length === 0 && (
                <li className="ttk-visitor-empty">Ничего не найдено. Измените запрос или категорию.</li>
              )}
              {visiblePois.map((poi) => (
                <li key={poi.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectPoi(poi)}
                    className={`w-full text-left px-3 py-2.5 flex items-start gap-2 hover:bg-slate-50 ${
                      selectedPoiId === poi.id ? 'bg-brand-50' : ''
                    }`}
                  >
                    <span className="mt-0.5 text-brand-600 shrink-0">
                      <Icon name={categoryIcon(poi)} className="w-4 h-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold truncate">{poi.title}</span>
                      <span className="block text-[11px] text-slate-500 truncate">
                        {poi.categoryLabel}
                        {poi.description ? ` · ${poi.description}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}

        <section className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0">
            <PublicPlan
              model={model}
              selectedPoiId={selectedPoiId}
              activePanoramaId={activePanoramaId}
              routePolyline={routePolylines}
              zoom={zoom}
              compact={isEmbed}
              onSelectPoi={handleSelectPoi}
              onOpenPanorama={(panorama) => openPanorama(panorama)}
              onZoomIn={() => setZoom((value) => Math.min(2.2, value + 0.2))}
              onZoomOut={() => setZoom((value) => Math.max(0.8, value - 0.2))}
              onResetZoom={() => setZoom(1)}
            />
          </div>

          {isEmbed && (
            <div className="flex gap-1.5 overflow-x-auto custom-scrollbar p-2 border-t border-slate-200 bg-white">
              {model.pois.map((poi) => (
                <button
                  key={poi.id}
                  type="button"
                  onClick={() => handleSelectPoi(poi)}
                  className={`ttk-visitor-chip shrink-0 ${selectedPoiId === poi.id ? 'is-active' : ''}`}
                >
                  {poi.title}
                </button>
              ))}
            </div>
          )}

          {selectedPoi && (
            <div className="border-t border-slate-200 bg-white p-3 space-y-2 animate-view-enter" data-testid="poi-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-sm font-bold truncate">{selectedPoi.title}</h2>
                  <p className="text-[11px] text-slate-500">{selectedPoi.categoryLabel}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPoiId(null)}
                  aria-label="Закрыть карточку"
                  className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"
                >
                  <Icon name="x" className="w-4 h-4" />
                </button>
              </div>
              {selectedPoi.description && (
                <p className="text-xs text-slate-600 leading-relaxed">{selectedPoi.description}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleRouteTo(selectedPoi)}
                  className="flex-1 min-w-[8rem] bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold py-2 rounded-xl flex items-center justify-center gap-1.5"
                >
                  <Icon name="route" className="w-3.5 h-3.5" /> Маршрут сюда
                </button>
                <button
                  type="button"
                  onClick={() => openPanoramaForPoi(selectedPoi)}
                  className="flex-1 min-w-[8rem] bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold py-2 rounded-xl flex items-center justify-center gap-1.5"
                >
                  <Icon name="rotate-3d" className="w-3.5 h-3.5" /> Панорама 360°
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {selectedPanorama && (
        <PanoramaViewer
          isOpen
          onClose={() => setActivePanoramaId(null)}
          title={selectedPanorama.title}
          imageUrl={selectedPanorama.asset?.mobile_url ?? selectedPanorama.asset?.full_url ?? ''}
          panorama={snapshot?.document.panoramas.find((item) => item.id === selectedPanorama.id) ?? null}
          panoramas={snapshot?.document.panoramas ?? []}
          hotspots={snapshot?.document.hotspots ?? []}
          pois={snapshot?.document.pois ?? []}
          assets={snapshot?.assets ?? []}
          initialYawDeg={panoramaYaw}
          onSelectPanorama={(panoramaId) => {
            const target = findPanorama(model, panoramaId);
            if (target) openPanorama(target);
          }}
          onSelectPoi={(poiId) => setSelectedPoiId(poiId)}
        />
      )}
    </div>
  );
};

export default PublicSpacePage;
