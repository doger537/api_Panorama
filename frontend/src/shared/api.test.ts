import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, apiClient, getCsrfToken, getMapEtag, setCsrfToken, setMapEtag } from './api';

describe('API client error handling', () => {
  beforeEach(() => {
    setCsrfToken(null);
    vi.unstubAllGlobals();
  });

  it('wraps 401 responses into ApiClientError with typed body', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Session expired',
          issues: [],
          current_revision: null,
        },
      }),
    });

    await expect(apiClient.session()).rejects.toThrow(ApiClientError);
    await expect(apiClient.session()).rejects.toMatchObject({
      status: 401,
      body: { error: { code: 'AUTH_REQUIRED' } },
    });
  });

  it('handles 204 No Content as undefined data', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
    });

    const result = await apiClient.logout();
    expect(result).toBeUndefined();
  });

  it('handles 304 Not Modified with preserved ETag', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 304,
      headers: new Map([['ETag', '"cached-etag"']]),
      json: async () => null,
    });

    const result = await apiClient.getPublicMap('test-slug', '"cached-etag"');
    expect(result.status).toBe(304);
    expect(result.etag).toBe('"cached-etag"');
  });

  it('manages CSRF token in memory only', () => {
    expect(getCsrfToken()).toBeNull();
    setCsrfToken('test-token-abc');
    expect(getCsrfToken()).toBe('test-token-abc');
    setCsrfToken(null);
    expect(getCsrfToken()).toBeNull();
  });

  it('caches and retrieves ETag per map ID', () => {
    const mapId = '123e4567-e89b-12d3-a456-426614174000';
    expect(getMapEtag(mapId)).toBeUndefined();
    setMapEtag(mapId, '"map-v5"');
    expect(getMapEtag(mapId)).toBe('"map-v5"');
  });

  it('includes If-Match header from stored ETag', async () => {
    const mapId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    setMapEtag(mapId, '"v2"');
    setCsrfToken('csrf-token');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([['ETag', '"v3"']]),
      json: async () => ({
        snapshot: {
          id: mapId,
          slug: 'test',
          revision: 3,
          width_units: 1000,
          height_units: 500,
          updated_at: '2026-01-01T00:00:00Z',
          document: { title: 'Test Map', description: '', is_published: false, shapes: [], nodes: [], edges: [], pois: [], panoramas: [], hotspots: [], scale_m_per_unit: null, max_walk_gap_units: 50, background_asset_id: null },
          assets: [],
        },
        owner_id: 'owner-id',
        created_at: '2026-01-01T00:00:00Z',
      }),
    });

    const doc = {
      title: 'Updated',
      description: '',
      is_published: false,
      shapes: [],
      nodes: [],
      edges: [],
      pois: [],
      panoramas: [],
      hotspots: [],
      scale_m_per_unit: null,
      max_walk_gap_units: 50,
      background_asset_id: null,
    };

    await apiClient.replaceMapDocument(mapId, doc);

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1].headers['If-Match']).toBe('"v2"');
    expect(getMapEtag(mapId)).toBe('"v3"');
  });

  it('throws ApiClientError on 412 conflict with current_revision', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 412,
      json: async () => ({
        error: {
          code: 'VERSION_CONFLICT',
          message: 'Document was modified by another editor',
          issues: [],
          current_revision: 8,
        },
      }),
    });

    try {
      await apiClient.replaceMapDocument('map-id', {
        title: 'Conflict',
        description: '',
        is_published: false,
        shapes: [],
        nodes: [],
        edges: [],
        pois: [],
        panoramas: [],
        hotspots: [],
        scale_m_per_unit: null,
        max_walk_gap_units: 50,
        background_asset_id: null,
      });
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).body?.error.current_revision).toBe(8);
    }
  });
});
