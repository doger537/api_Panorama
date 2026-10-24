import type { Point } from '../../../CONTRACTS/types';

export function svgPointFromClient(clientX: number, clientY: number, rect: DOMRect, width: number, height: number): Point {
  const scale = Math.min(rect.width / width, rect.height / height);
  if (!Number.isFinite(scale) || scale <= 0) return { x: 0, y: 0 };
  const left = rect.left + (rect.width - width * scale) / 2;
  const top = rect.top + (rect.height - height * scale) / 2;
  return {
    x: Math.min(width, Math.max(0, (clientX - left) / scale)),
    y: Math.min(height, Math.max(0, (clientY - top) / scale)),
  };
}

export function normalizeYaw(value: number): number {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return wrapped === 180 ? -180 : wrapped;
}

export function bearingFromPlan(dx: number, dy: number): number {
  return normalizeYaw((Math.atan2(dx, -dy) * 180) / Math.PI);
}

export function yawToTarget(dx: number, dy: number, headingOffsetDeg: number): number {
  return normalizeYaw(bearingFromPlan(dx, dy) - headingOffsetDeg);
}

export type CardinalDir = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export function cardinalDirection(bearing: number): CardinalDir {
  const n = normalizeYaw(bearing);
  if (n >= -22.5 && n < 22.5) return 'N';
  if (n >= 22.5 && n < 67.5) return 'NE';
  if (n >= 67.5 && n < 112.5) return 'E';
  if (n >= 112.5 && n < 157.5) return 'SE';
  if (n >= 157.5 || n < -157.5) return 'S';
  if (n >= -157.5 && n < -112.5) return 'SW';
  if (n >= -112.5 && n < -67.5) return 'W';
  return 'NW';
}

export function angleDelta(from: number, to: number): number {
  return normalizeYaw(to - from);
}

/** Includes viewport zoom/pan and SVG letterboxing. */
export function pointFromSvg(svg: SVGSVGElement, clientX: number, clientY: number): Point {
  const matrix = svg.getScreenCTM?.();
  if (matrix && typeof DOMPoint !== 'undefined') {
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }
  const [,,width,height] = (svg.getAttribute('viewBox') ?? '0 0 700 500').split(/\s+/).map(Number);
  return svgPointFromClient(clientX, clientY, svg.getBoundingClientRect(), width, height);
}
