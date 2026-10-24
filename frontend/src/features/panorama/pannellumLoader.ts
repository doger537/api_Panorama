/**
 * Loader for the vendored Pannellum build.
 *
 * The npm package ships a classic browser script that assigns `window.pannellum`
 * instead of exporting an ES module, so it is imported lazily: importing it at
 * module scope would touch `window` during SSR/test collection and break
 * environments without WebGL.
 */

export interface PannellumViewerLike {
  destroy(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  isLoaded(): boolean;
  getYaw(): number;
  getPitch(): number;
  getHfov(): number;
  setYaw(value: number, animated?: boolean | number): void;
  setPitch(value: number, animated?: boolean | number): void;
  setHfov(value: number, animated?: boolean | number): void;
  setYawBounds(bounds: [number, number]): void;
  setPitchBounds(bounds: [number, number]): void;
  setHfovBounds(bounds: [number, number]): void;
  getContainer(): HTMLElement;
  addHotSpot(hotspot: unknown): void;
  removeHotSpot(id: string): boolean;
  mouseEventToCoords(event: MouseEvent): [number, number] | undefined;
  lookAt(pitch: number, yaw: number, hfov: number, animated?: boolean | number): void;
  toggleFullscreen(): void;
  resize(): void;
}

export interface PannellumApi {
  viewer(container: HTMLElement | string, config: Record<string, unknown>): PannellumViewerLike;
}

export class PannellumUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PannellumUnavailableError';
  }
}

let cached: Promise<PannellumApi> | null = null;

function readGlobal(): PannellumApi | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as unknown as { pannellum?: PannellumApi }).pannellum;
  return candidate && typeof candidate.viewer === 'function' ? candidate : null;
}

async function importPannellum(): Promise<PannellumApi> {
  const existing = readGlobal();
  if (existing) return existing;

  await import('pannellum/build/pannellum.css');
  await import('pannellum/build/pannellum.js');

  const api = readGlobal();
  if (!api) {
    throw new PannellumUnavailableError('Библиотека Pannellum не загрузилась в этом окружении');
  }
  return api;
}

export function loadPannellum(): Promise<PannellumApi> {
  if (!cached) {
    cached = importPannellum().catch((error: unknown) => {
      cached = null;
      throw error;
    });
  }
  return cached;
}

/** Test helper: forgets the cached module so mocks take effect again. */
export function resetPannellumLoaderForTests(): void {
  cached = null;
}
