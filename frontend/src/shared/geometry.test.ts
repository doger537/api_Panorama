import { describe, expect, it } from 'vitest';
import { boundingBox, distance, pointInPolygon, pointOnSegment, polygonArea, polygonCentroid } from './geometry';

describe('geometry helpers', () => {
  it('computes Euclidean distance between points', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(distance({ x: 10, y: 20 }, { x: 10, y: 20 })).toBe(0);
  });

  it('interpolates a point on a segment', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 200 };
    expect(pointOnSegment(a, b, 0)).toEqual(a);
    expect(pointOnSegment(a, b, 1)).toEqual(b);
    expect(pointOnSegment(a, b, 0.5)).toEqual({ x: 50, y: 100 });
  });

  it('computes polygon area', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(polygonArea(square)).toBe(100);

    const triangle = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ];
    expect(polygonArea(triangle)).toBe(50);
  });

  it('computes polygon centroid', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const center = polygonCentroid(square);
    expect(center?.x).toBeCloseTo(50, 1);
    expect(center?.y).toBeCloseTo(50, 1);
  });

  it('computes bounding box', () => {
    const points = [
      { x: 10, y: 20 },
      { x: 50, y: 5 },
      { x: 30, y: 40 },
    ];
    const box = boundingBox(points);
    expect(box).toEqual({
      min: { x: 10, y: 5 },
      max: { x: 50, y: 40 },
      width: 40,
      height: 35,
    });
  });

  it('tests point inside polygon', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 50 }, square)).toBe(false);
    expect(pointInPolygon({ x: 0, y: 0 }, square)).toBe(true);
  });
});
