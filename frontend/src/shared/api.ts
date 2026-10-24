import type {
  ApiError,
  AssetRef,
  AssetUpload,
  Capture,
  CreateCaptureRequest,
  CreateMapRequest,
  FrameUpload,
  Health,
  LoginRequest,
  MapDocument,
  MapSummary,
  OrganizerMap,
  PublicMap,
  RouteRequest,
  RouteResponse,
  Session,
  Slug,
  UUID,
} from '../../../CONTRACTS/types';

export class ApiClientError extends Error {
  readonly status: number;
  readonly body: ApiError | null;

  constructor(status: number, body: ApiError | null) {
    super(body?.error.message ?? `Request failed with status ${status}`);
    this.name = 'ApiClientError';
    this.status = status;
    this.body = body;
  }
}

let inMemoryCsrfToken: string | null = null;
const mapEtagStore = new Map<string, string>();

export function getCsrfToken(): string | null {
  return inMemoryCsrfToken;
}

export function setCsrfToken(token: string | null): void {
  inMemoryCsrfToken = token;
}

export function getMapEtag(mapId: UUID): string | undefined {
  return mapEtagStore.get(mapId);
}

export function setMapEtag(mapId: UUID, etag: string | null): void {
  if (etag) {
    mapEtagStore.set(mapId, etag);
  }
}

function originHeader(): Record<string, string> {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return { Origin: window.location.origin };
  }
  return { Origin: 'http://127.0.0.1:5173' };
}

function csrfHeaders(): Record<string, string> {
  return {
    ...originHeader(),
    ...(inMemoryCsrfToken ? { 'X-CSRF-Token': inMemoryCsrfToken } : {}),
  };
}

async function requestWithResponse<T>(path: string, init: RequestInit = {}): Promise<{ data: T; response: Response }> {
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (response.status === 204 || response.status === 304) {
    return { data: undefined as T, response };
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiClientError(response.status, body as ApiError | null);
  }
  return { data: body as T, response };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await requestWithResponse<T>(path, init);
  return data;
}

export const apiClient = {
  health: () => request<Health>('/healthz'),

  login: async (input: LoginRequest): Promise<Session> => {
    const sess = await request<Session>('/api/v1/auth/login', {
      method: 'POST',
      headers: originHeader(),
      body: JSON.stringify(input),
    });
    setCsrfToken(sess.csrf_token);
    return sess;
  },

  session: async (): Promise<Session> => {
    const sess = await request<Session>('/api/v1/auth/session');
    setCsrfToken(sess.csrf_token);
    return sess;
  },

  logout: async (): Promise<void> => {
    await request<void>('/api/v1/auth/logout', {
      method: 'POST',
      headers: csrfHeaders(),
    });
    setCsrfToken(null);
  },

  listMaps: async (): Promise<MapSummary[]> => {
    const maps: MapSummary[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await request<MapSummary[]>(`/api/v1/maps?offset=${offset}&limit=100`);
      maps.push(...page);
      if (page.length < 100) return maps;
    }
  },

  createMap: async (input: CreateMapRequest): Promise<{ map: OrganizerMap; etag: string }> => {
    const { data, response } = await requestWithResponse<OrganizerMap>('/api/v1/maps', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify(input),
    });
    const etag = response.headers.get('ETag') ?? `"map-${data.snapshot.id}-v${data.snapshot.revision}"`;
    setMapEtag(data.snapshot.id, etag);
    return { map: data, etag };
  },

  getMap: async (mapId: UUID): Promise<{ map: OrganizerMap; etag: string }> => {
    const { data, response } = await requestWithResponse<OrganizerMap>(`/api/v1/maps/${mapId}`);
    const etag = response.headers.get('ETag') ?? `"map-${data.snapshot.id}-v${data.snapshot.revision}"`;
    setMapEtag(data.snapshot.id, etag);
    return { map: data, etag };
  },

  deleteMap: async (mapId: UUID, ifMatch?: string): Promise<void> => {
    const tag = ifMatch ?? getMapEtag(mapId) ?? `"map-${mapId}-v1"`;
    await request<void>(`/api/v1/maps/${mapId}`, {
      method: 'DELETE',
      headers: { ...csrfHeaders(), 'If-Match': tag },
    });
    mapEtagStore.delete(mapId);
  },

  replaceMapDocument: async (
    mapId: UUID,
    doc: MapDocument,
    ifMatch?: string,
  ): Promise<{ map: OrganizerMap; etag: string }> => {
    const tag = ifMatch ?? getMapEtag(mapId) ?? `"map-${mapId}-v1"`;
    const { data, response } = await requestWithResponse<OrganizerMap>(`/api/v1/maps/${mapId}/document`, {
      method: 'PUT',
      headers: { ...csrfHeaders(), 'If-Match': tag },
      body: JSON.stringify(doc),
    });
    const nextEtag = response.headers.get('ETag') ?? `"map-${data.snapshot.id}-v${data.snapshot.revision}"`;
    setMapEtag(data.snapshot.id, nextEtag);
    return { map: data, etag: nextEtag };
  },

  listAssets: (mapId: UUID) => request<AssetRef[]>(`/api/v1/maps/${mapId}/assets`),

  uploadAsset: (mapId: UUID, input: AssetUpload): Promise<AssetRef> => {
    const form = new FormData();
    form.append('kind', input.kind);
    form.append('file', input.file);
    return request<AssetRef>(`/api/v1/maps/${mapId}/assets`, {
      method: 'POST',
      headers: csrfHeaders(),
      body: form,
    });
  },

  listCaptures: (mapId: UUID) => request<Capture[]>(`/api/v1/maps/${mapId}/captures`),

  createCapture: (mapId: UUID, input: CreateCaptureRequest) =>
    request<Capture>(`/api/v1/maps/${mapId}/captures`, {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify(input),
    }),

  getCapture: (mapId: UUID, captureId: UUID) =>
    request<Capture>(`/api/v1/maps/${mapId}/captures/${captureId}`),

  uploadCaptureFrame: (mapId: UUID, captureId: UUID, index: number, input: FrameUpload) => {
    const form = new FormData();
    form.append('file', input.file);
    return request<Capture>(`/api/v1/maps/${mapId}/captures/${captureId}/frames/${index}`, {
      method: 'PUT',
      headers: csrfHeaders(),
      body: form,
    });
  },

  startStitch: (mapId: UUID, captureId: UUID) =>
    request<Capture>(`/api/v1/maps/${mapId}/captures/${captureId}/stitch`, {
      method: 'POST',
      headers: csrfHeaders(),
    }),

  cancelCapture: (mapId: UUID, captureId: UUID) =>
    request<Capture>(`/api/v1/maps/${mapId}/captures/${captureId}/cancel`, {
      method: 'POST',
      headers: csrfHeaders(),
    }),

  getPublicMap: async (
    slug: Slug,
    ifNoneMatch?: string,
  ): Promise<{ status: 200; map: PublicMap; etag: string } | { status: 304; etag: string }> => {
    const { data, response } = await requestWithResponse<PublicMap>(`/api/v1/public/maps/${slug}`, {
      headers: ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {},
    });
    const etag = response.headers.get('ETag') ?? ifNoneMatch ?? '';
    if (response.status === 304) {
      return { status: 304, etag };
    }
    return { status: 200, map: data, etag };
  },

  buildRoute: (slug: Slug, input: RouteRequest) =>
    request<RouteResponse>(`/api/v1/public/maps/${slug}/route`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
