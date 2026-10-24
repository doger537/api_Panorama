import React from 'react';
import type { Point } from '../../../../CONTRACTS/types';
import { Icon } from '../../shared/Icon';
import { categoryIcon, type VisitorModel, type VisitorPanorama, type VisitorPoi } from './model';
import './visitor.css';

export interface PublicPlanProps {
  model: VisitorModel;
  selectedPoiId: string | null;
  activePanoramaId?: string | null;
  routePolyline?: Point[] | null;
  zoom?: number;
  compact?: boolean;
  onSelectPoi: (poi: VisitorPoi) => void;
  onOpenPanorama: (panorama: VisitorPanorama) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
}

const SHAPE_STYLE: Record<string, { fill: string; stroke: string }> = {
  room: { fill: 'rgba(227, 27, 35, 0.06)', stroke: '#cbd5e1' },
  corridor: { fill: 'rgba(148, 163, 184, 0.14)', stroke: '#cbd5e1' },
  wall: { fill: 'none', stroke: '#94a3b8' },
};

export const PublicPlan: React.FC<PublicPlanProps> = ({
  model,
  selectedPoiId,
  activePanoramaId = null,
  routePolyline = null,
  zoom = 1,
  compact = false,
  onSelectPoi,
  onOpenPanorama,
  onZoomIn,
  onZoomOut,
  onResetZoom,
}) => {
  const { widthUnits, heightUnits } = model;
  const toPercentX = (x: number) => `${Math.max(0, Math.min(100, (x / widthUnits) * 100))}%`;
  const toPercentY = (y: number) => `${Math.max(0, Math.min(100, (y / heightUnits) * 100))}%`;

  return (
    <div className="ttk-plan" data-testid="public-plan">
      <div className="ttk-plan__toolbar">
        <span className="ttk-plan__badge">
          <Icon name="map" className="w-3.5 h-3.5" /> {model.stats.poiCount} объектов ·{' '}
          {model.stats.panoramaCount} панорам
        </span>
        {!compact && (
          <div className="ttk-plan__zoom">
            <button type="button" onClick={onZoomOut} aria-label="Отдалить план" title="Отдалить">
              <Icon name="zoom-out" className="w-4 h-4" />
            </button>
            <button type="button" onClick={onResetZoom} aria-label="Сбросить масштаб" title="Сбросить масштаб">
              <Icon name="maximize-2" className="w-4 h-4" />
            </button>
            <button type="button" onClick={onZoomIn} aria-label="Приблизить план" title="Приблизить">
              <Icon name="zoom-in" className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <div className="ttk-plan__scroll custom-scrollbar">
        <div
          className="ttk-plan__stage"
          style={{
            aspectRatio: `${widthUnits} / ${heightUnits}`,
            transform: `scale(${zoom})`,
          }}
        >
          <svg
            className="ttk-plan__svg"
            viewBox={`0 0 ${widthUnits} ${heightUnits}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={`План: ${model.title}`}
          >
            {model.backgroundUrl && (
              <image
                href={model.backgroundUrl}
                x={0}
                y={0}
                width={widthUnits}
                height={heightUnits}
                preserveAspectRatio="none"
                data-testid="plan-background"
              />
            )}

            {/* Navigation graph stays available for debugging but is not shown by default. */}
            {!model.backgroundUrl &&
              model.shapes.map((shape) => {
                const style = SHAPE_STYLE[shape.kind] ?? SHAPE_STYLE.room;
                const points = shape.points.map((point) => `${point.x},${point.y}`).join(' ');
                return shape.kind === 'wall' ? (
                  <polyline
                    key={shape.id}
                    points={points}
                    fill="none"
                    stroke={style.stroke}
                    strokeWidth={3}
                    strokeLinejoin="round"
                  />
                ) : (
                  <polygon
                    key={shape.id}
                    points={points}
                    fill={style.fill}
                    stroke={style.stroke}
                    strokeWidth={2}
                  />
                );
              })}

            {model.backgroundUrl &&
              model.shapes.map((shape) => {
                const points = shape.points.map((point) => `${point.x},${point.y}`).join(' ');
                return (
                  <polygon
                    key={`overlay-${shape.id}`}
                    points={points}
                    fill={shape.kind === 'corridor' ? 'rgba(148, 163, 184, 0.12)' : 'transparent'}
                    stroke={shape.kind === 'wall' ? 'rgba(227, 27, 35, 0.45)' : 'transparent'}
                    strokeWidth={2}
                  />
                );
              })}

            {routePolyline && routePolyline.length >= 2 && (
              <polyline
                data-testid="route-polyline"
                points={routePolyline.map((point) => `${point.x},${point.y}`).join(' ')}
                fill="none"
                stroke="#e31b23"
                strokeWidth={Math.max(4, widthUnits / 140)}
                strokeLinecap="round"
                strokeDasharray="10 8"
                className="animate-route"
              />
            )}

            {routePolyline && routePolyline.length >= 2 && (
              <>
                <circle
                  cx={routePolyline[0].x}
                  cy={routePolyline[0].y}
                  r={Math.max(6, widthUnits / 90)}
                  fill="#16a34a"
                  stroke="#fff"
                  strokeWidth={2}
                />
                <circle
                  cx={routePolyline[routePolyline.length - 1].x}
                  cy={routePolyline[routePolyline.length - 1].y}
                  r={Math.max(6, widthUnits / 90)}
                  fill="#e31b23"
                  stroke="#fff"
                  strokeWidth={2}
                />
              </>
            )}
          </svg>

          {/* POI pins */}
          {model.pois.map((poi) => (
            <button
              key={poi.id}
              type="button"
              className={`ttk-plan__pin ttk-plan__pin--${poi.category} ${
                selectedPoiId === poi.id ? 'is-selected' : ''
              }`}
              style={{ left: toPercentX(poi.x), top: toPercentY(poi.y) }}
              onClick={() => onSelectPoi(poi)}
              aria-label={`Точка: ${poi.title}`}
              title={poi.title}
            >
              <Icon name={categoryIcon(poi)} className="w-3.5 h-3.5" />
              <span className="ttk-plan__pin-label">{poi.title}</span>
            </button>
          ))}

          {/* Panorama markers */}
          {model.panoramas.map((panorama) => (
            <button
              key={panorama.id}
              type="button"
              className={`ttk-plan__pano ${activePanoramaId === panorama.id ? 'is-active' : ''}`}
              style={{ left: toPercentX(panorama.x), top: toPercentY(panorama.y) }}
              onClick={() => onOpenPanorama(panorama)}
              aria-label={`Панорама: ${panorama.title}`}
              title={`Панорама 360°: ${panorama.title}`}
            >
              <span className="ttk-plan__pano-dot" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
