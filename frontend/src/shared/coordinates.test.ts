import { describe, expect, it } from 'vitest';
import { bearingFromPlan, normalizeYaw, svgPointFromClient, yawToTarget, cardinalDirection, angleDelta } from './coordinates';

describe('plan and panorama coordinate conventions', () => {
  it('maps client positions into plan units and clamps to the map', () => {
    const rect = { left: 10, top: 20, width: 200, height: 100 } as DOMRect;
    expect(svgPointFromClient(110, 70, rect, 1000, 500)).toEqual({ x: 500, y: 250 });
    expect(svgPointFromClient(-20, 400, rect, 1000, 500)).toEqual({ x: 0, y: 500 });
  });

  it('uses plan up as zero bearing and wraps yaw into [-180, 180)', () => {
    expect(bearingFromPlan(0, -1)).toBe(0);
    expect(bearingFromPlan(1, 0)).toBe(90);
    expect(bearingFromPlan(0, 1)).toBe(-180);
    expect(normalizeYaw(181)).toBe(-179);
    expect(normalizeYaw(-180)).toBe(-180);
    expect(normalizeYaw(360)).toBe(0);
    expect(normalizeYaw(-540)).toBe(-180);
    expect(yawToTarget(1, 0, 30)).toBe(60);
  });

  it('identifies eight cardinal directions for plan layout', () => {
    expect(cardinalDirection(0)).toBe('N');
    expect(cardinalDirection(45)).toBe('NE');
    expect(cardinalDirection(90)).toBe('E');
    expect(cardinalDirection(135)).toBe('SE');
    expect(cardinalDirection(180)).toBe('S');
    expect(cardinalDirection(-135)).toBe('SW');
    expect(cardinalDirection(-90)).toBe('W');
    expect(cardinalDirection(-45)).toBe('NW');
    expect(cardinalDirection(22)).toBe('N');
    expect(cardinalDirection(23)).toBe('NE');
  });

  it('computes shortest signed angle delta for rotation', () => {
    expect(angleDelta(10, 20)).toBe(10);
    expect(angleDelta(170, -170)).toBe(20);
    expect(angleDelta(-170, 170)).toBe(-20);
    expect(angleDelta(0, 180)).toBeCloseTo(-180, 5);
  });

  it('handles non-standard plan dimensions and preserves aspect', () => {
    const rect = { left: 0, top: 0, width: 300, height: 450 } as DOMRect;
    expect(svgPointFromClient(150, 225, rect, 600, 900)).toEqual({ x: 300, y: 450 });
    expect(svgPointFromClient(300, 0, rect, 600, 900)).toEqual({ x: 600, y: 0 });
    expect(svgPointFromClient(0, 450, rect, 600, 900)).toEqual({ x: 0, y: 900 });
  });
});
