import React, { useCallback, useRef } from 'react';
import type { MapDocument } from '../../../../CONTRACTS/types';
import { pointFromSvg } from '../../shared/coordinates';
import { Icon } from '../../shared/Icon';
import './capture.css';

export interface CapturePointPickerProps {
  widthUnits: number;
  heightUnits: number;
  document?: MapDocument | null;
  value: { x: number; y: number };
  onChange: (point: { x: number; y: number }) => void;
  /** Existing capture points, drawn as ghost markers. */
  existing?: { id: string; x: number; y: number; title: string }[];
}

/**
 * Tap-to-place capture point on the plan, replacing raw X/Y inputs.
 * The organizer stands where the sphere will be shot, which is what links the
 * panorama to a coordinate on the 2D map.
 */
export const CapturePointPicker: React.FC<CapturePointPickerProps> = ({
  widthUnits,
  heightUnits,
  document: mapDocument = null,
  value,
  onChange,
  existing = [],
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const handleClick = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current) return;
      const point = pointFromSvg(svgRef.current, event.clientX, event.clientY);
      onChange({ x: Math.max(0, Math.min(widthUnits, Math.round(point.x * 10) / 10)), y: Math.max(0, Math.min(heightUnits, Math.round(point.y * 10) / 10)) });
    },
    [heightUnits, onChange, widthUnits],
  );

  const shapes = mapDocument?.shapes ?? [];

  return (
    <div className="ttk-capture-picker">
      <div className="ttk-capture-picker__header">
        <span className="ttk-capture-picker__title">
          <Icon name="map" className="w-3.5 h-3.5" /> Точка съёмки на плане
        </span>
        <span className="ttk-capture-picker__coords" data-testid="capture-point-coords">
          X {value.x.toFixed(1)} · Y {value.y.toFixed(1)}
        </span>
      </div>
      <svg
        ref={svgRef}
        className="ttk-capture-picker__svg"
        viewBox={`0 0 ${widthUnits} ${heightUnits}`}
        style={{ aspectRatio: `${widthUnits} / ${heightUnits}` }}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Выбор точки съёмки на плане"
        data-testid="capture-point-picker"
        onClick={handleClick}
      >
        <rect width={widthUnits} height={heightUnits} fill="#f8fafc" />
        {mapDocument?.background_asset_id && (
          <image href={`/api/v1/media/${mapDocument.background_asset_id}/full`}
            width={widthUnits} height={heightUnits} preserveAspectRatio="none" />
        )}
        {shapes.map((shape) => {
          const points = shape.points.map((point) => `${point.x},${point.y}`).join(' ');
          return shape.kind === 'wall' ? (
            <polyline key={shape.id} points={points} fill="none" stroke="#94a3b8" strokeWidth={3} />
          ) : (
            <polygon key={shape.id} points={points} fill="rgba(148,163,184,0.14)" stroke="#cbd5e1" strokeWidth={2} />
          );
        })}

        {existing.map((marker) => (
          <g key={marker.id} data-testid="existing-capture-point">
            <circle cx={marker.x} cy={marker.y} r={9} fill="rgba(227,27,35,0.18)" stroke="#e31b23" strokeWidth={2} />
            <title>{marker.title}</title>
          </g>
        ))}

        <g data-testid="capture-point-marker">
          <circle cx={value.x} cy={value.y} r={16} fill="rgba(227,27,35,0.16)" />
          <circle cx={value.x} cy={value.y} r={8} fill="#e31b23" stroke="#ffffff" strokeWidth={2} />
          <line x1={value.x - 24} y1={value.y} x2={value.x + 24} y2={value.y} stroke="#e31b23" strokeWidth={1.5} strokeDasharray="3 3" />
          <line x1={value.x} y1={value.y - 24} x2={value.x} y2={value.y + 24} stroke="#e31b23" strokeWidth={1.5} strokeDasharray="3 3" />
        </g>
      </svg>
      <p className="ttk-capture-picker__hint">Нажмите на план в том месте, где будете снимать панораму.</p>
    </div>
  );
};
