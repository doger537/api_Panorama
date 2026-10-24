import { describe, it, expect, afterAll } from 'vitest';
import { loadPannellum, resetPannellumLoaderForTests } from './pannellumLoader';

/**
 * Integration check of the real vendored bundle (no mocks): the npm package is
 * a classic script that assigns `window.pannellum`, so this proves the lazy
 * loader actually produces a usable viewer API in a browser-like environment.
 */
describe('pannellum loader', () => {
  afterAll(() => {
    resetPannellumLoaderForTests();
  });

  it('loads the vendored bundle and exposes the viewer factory', async () => {
    const api = await loadPannellum();
    expect(typeof api.viewer).toBe('function');
    expect(window.pannellum?.viewer).toBeTypeOf('function');
  });

  it('caches the module between calls', async () => {
    const first = await loadPannellum();
    const second = await loadPannellum();
    expect(second).toBe(first);
  });

  it('reuses an already present global instead of importing twice', async () => {
    const fake = { viewer: () => ({}) };
    const original = window.pannellum;
    window.pannellum = fake as unknown as typeof window.pannellum;
    resetPannellumLoaderForTests();
    try {
      await expect(loadPannellum()).resolves.toBe(fake);
    } finally {
      window.pannellum = original;
      resetPannellumLoaderForTests();
    }
  });
});
