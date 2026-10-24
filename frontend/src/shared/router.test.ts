import { describe, expect, it } from 'vitest';
import { matchRoute } from './router';

describe('router', () => {
  it('matches static routes exactly', () => {
    expect(matchRoute('/login', '/login')).toEqual({ path: '/login', params: {} });
    expect(matchRoute('/login', '/signup')).toBeNull();
    expect(matchRoute('/', '/')).toEqual({ path: '/', params: {} });
  });

  it('extracts dynamic segments from parameterized routes', () => {
    const match = matchRoute('/m/:slug', '/m/abc123');
    expect(match).not.toBeNull();
    expect(match?.params.slug).toBe('abc123');

    const orgMatch = matchRoute('/organize/:mapId', '/organize/aaaa-bbbb-cccc-dddd');
    expect(orgMatch?.params.mapId).toBe('aaaa-bbbb-cccc-dddd');
  });

  it('returns null when pattern and path have different lengths', () => {
    expect(matchRoute('/m/:slug', '/m/abc/extra')).toBeNull();
    expect(matchRoute('/organize/:mapId/edit', '/organize/mapid')).toBeNull();
  });

  it('supports multiple dynamic segments', () => {
    const match = matchRoute('/org/:orgId/map/:mapId', '/org/org1/map/map2');
    expect(match?.params).toEqual({ orgId: 'org1', mapId: 'map2' });
  });
});
