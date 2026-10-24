import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeVideoFrame } from './frame';

function video(width: number, height: number, readyState = 2) {
  const element = document.createElement('video');
  Object.defineProperties(element, {
    videoWidth: { value: width }, videoHeight: { value: height }, readyState: { value: readyState },
  });
  return element;
}

afterEach(() => vi.restoreAllMocks());

describe('real video frame encoder', () => {
  it.each([[1920, 1080, 1600, 900], [1440, 1920, 1200, 1600], [320, 240, 320, 240]])(
    'preserves %s×%s aspect ratio inside the capture API bounds', async (width, height, expectedWidth, expectedHeight) => {
      const source = video(width, height);
      const drawImage = vi.fn();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
      const blob = new Blob(['jpeg'], { type: 'image/jpeg' });
      vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) {
        expect(this.width).toBe(expectedWidth);
        expect(this.height).toBe(expectedHeight);
        callback(blob);
      });
      const file = await encodeVideoFrame(source, 3);
      expect(drawImage).toHaveBeenCalledWith(source, 0, 0, expectedWidth, expectedHeight);
      expect(file.name).toBe('capture-frame-03.jpg');
      expect(file.size).toBe(blob.size);
    },
  );

  it.each([null, video(0, 0), video(640, 480, 1)])('rejects unavailable video without manufacturing an image', async (source) => {
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    await expect(encodeVideoFrame(source, 0)).rejects.toThrow('Камера ещё не готова');
    expect(canvas).not.toHaveBeenCalled();
  });

  it('reports a failed encoder instead of uploading an empty file', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(null));
    await expect(encodeVideoFrame(video(600, 800), 0)).rejects.toThrow('Не удалось сохранить кадр');
  });
});
