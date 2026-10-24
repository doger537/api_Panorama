import type { MapDocument } from '../../../CONTRACTS/types';
import { ApiClientError } from './api';

export interface ConflictResolution<T> {
  type: 'keep_local' | 'use_server' | 'retry';
  localChanges?: T;
  serverRevision?: number;
}

export function isVersionConflict(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 412 && error.body?.error.code === 'VERSION_CONFLICT';
}

export function extractServerRevision(error: ApiClientError): number | null {
  return error.body?.error.current_revision ?? null;
}

export function preserveLocalChanges<T>(localData: T, onConflict: (local: T, serverRevision: number) => void) {
  return async (operation: () => Promise<void>): Promise<void> => {
    try {
      await operation();
    } catch (err) {
      if (isVersionConflict(err)) {
        const serverRevision = extractServerRevision(err as ApiClientError);
        if (serverRevision !== null) {
          onConflict(localData, serverRevision);
          return;
        }
      }
      throw err;
    }
  };
}

export interface LocalDraft {
  mapId: string;
  document: MapDocument;
  baseRevision: number;
  timestamp: number;
}

export function saveDraft(draft: LocalDraft): void {
  try {
    const key = `draft:${draft.mapId}`;
    sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Storage quota exceeded or unavailable
  }
}

export function loadDraft(mapId: string): LocalDraft | null {
  try {
    const key = `draft:${mapId}`;
    const stored = sessionStorage.getItem(key);
    if (!stored) return null;
    return JSON.parse(stored) as LocalDraft;
  } catch {
    return null;
  }
}

export function clearDraft(mapId: string): void {
  try {
    const key = `draft:${mapId}`;
    sessionStorage.removeItem(key);
  } catch {
    // Ignore
  }
}
