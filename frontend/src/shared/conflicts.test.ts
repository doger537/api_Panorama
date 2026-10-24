import { beforeEach, describe, expect, it } from 'vitest';
import { ApiClientError } from './api';
import {
  clearDraft,
  extractServerRevision,
  isVersionConflict,
  loadDraft,
  preserveLocalChanges,
  saveDraft,
} from './conflicts';

describe('version conflict handling', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('detects 412 VERSION_CONFLICT errors', () => {
    const conflict = new ApiClientError(412, {
      error: {
        code: 'VERSION_CONFLICT',
        message: 'Document modified',
        issues: [],
        current_revision: 5,
      },
    });
    expect(isVersionConflict(conflict)).toBe(true);

    const notFound = new ApiClientError(404, {
      error: { code: 'NOT_FOUND', message: 'Not found', issues: [], current_revision: null },
    });
    expect(isVersionConflict(notFound)).toBe(false);
  });

  it('extracts server revision from conflict error', () => {
    const err = new ApiClientError(412, {
      error: {
        code: 'VERSION_CONFLICT',
        message: 'Conflict',
        issues: [],
        current_revision: 10,
      },
    });
    expect(extractServerRevision(err)).toBe(10);
  });

  it('preserves local changes on conflict and calls handler', async () => {
    const localDoc = { title: 'My Draft', shapes: [] };
    let savedLocal = null;
    let savedRevision = null;

    const operation = async () => {
      throw new ApiClientError(412, {
        error: {
          code: 'VERSION_CONFLICT',
          message: 'Conflict',
          issues: [],
          current_revision: 8,
        },
      });
    };

    const handler = preserveLocalChanges(localDoc, (local, rev) => {
      savedLocal = local;
      savedRevision = rev;
    });

    await handler(operation);

    expect(savedLocal).toEqual(localDoc);
    expect(savedRevision).toBe(8);
  });

  it('rethrows non-conflict errors', async () => {
    const operation = async () => {
      throw new Error('Network error');
    };

    const handler = preserveLocalChanges({}, () => {});

    await expect(handler(operation)).rejects.toThrow('Network error');
  });

  it('saves and loads draft from sessionStorage', () => {
    const draft = {
      mapId: 'map-abc',
      document: {
        title: 'Draft Map',
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
      },
      baseRevision: 3,
      timestamp: Date.now(),
    };

    saveDraft(draft);
    const loaded = loadDraft('map-abc');
    expect(loaded).toEqual(draft);

    clearDraft('map-abc');
    expect(loadDraft('map-abc')).toBeNull();
  });
});
