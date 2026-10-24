import { describe, it, expect, vi } from 'vitest';
import {
  missingFrameIndexes,
  uploadFrameWithRetry,
  uploadFramesSequentially,
} from './uploadQueue';

const noSleep = () => Promise.resolve();

describe('uploadFrameWithRetry', () => {
  it('returns the first successful result without retrying', async () => {
    const upload = vi.fn().mockResolvedValue('ok');
    const result = await uploadFrameWithRetry(upload, { sleep: noSleep });

    expect(result).toEqual({ ok: true, value: 'ok', attempts: 1 });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('retries a flaky upload and succeeds on the third attempt', async () => {
    const upload = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue('saved');
    const result = await uploadFrameWithRetry(upload, { attempts: 3, sleep: noSleep });

    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
    expect(upload).toHaveBeenCalledTimes(3);
  });

  it('gives up after the attempt budget and keeps the last error', async () => {
    const upload = vi.fn().mockRejectedValue(new Error('offline'));
    const result = await uploadFrameWithRetry(upload, { attempts: 2, sleep: noSleep });

    expect(result).toMatchObject({ ok: false, attempts: 2 });
    expect((result as { error: Error }).error.message).toBe('offline');
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('backs off between attempts', async () => {
    const sleep = vi.fn(() => Promise.resolve());
    await uploadFrameWithRetry(vi.fn().mockRejectedValue(new Error('x')), { attempts: 3, delayMs: 100, sleep });
    expect(sleep.mock.calls).toEqual([[100], [200]]);
  });
});

describe('uploadFramesSequentially', () => {
  it('uploads missing frames in order', async () => {
    const order: number[] = [];
    const uploaded: number[] = [];
    const result = await uploadFramesSequentially({
      indexes: [1, 2, 3],
      upload: async (index) => {
        order.push(index);
        return index;
      },
      sleep: noSleep,
      onFrameUploaded: (index) => uploaded.push(index),
    });

    expect(order).toEqual([1, 2, 3]);
    expect(uploaded).toEqual([1, 2, 3]);
    expect(result).toMatchObject({ uploaded: [1, 2, 3], failedIndex: null, cancelled: false });
  });

  it('stops at the first frame that never succeeds and reports it', async () => {
    const result = await uploadFramesSequentially({
      indexes: [0, 1, 2],
      attemptsPerFrame: 2,
      sleep: noSleep,
      upload: async (index) => {
        if (index === 1) throw new Error('413');
        return index;
      },
    });

    expect(result.uploaded).toEqual([0]);
    expect(result.failedIndex).toBe(1);
    expect((result.error as Error).message).toBe('413');
  });

  it('honours cancellation between frames', async () => {
    let cancelled = false;
    const result = await uploadFramesSequentially({
      indexes: [0, 1, 2],
      sleep: noSleep,
      isCancelled: () => cancelled,
      upload: async (index) => {
        cancelled = true;
        return index;
      },
    });

    expect(result.cancelled).toBe(true);
    expect(result.uploaded).toEqual([0]);
  });
});

describe('missingFrameIndexes', () => {
  it('lists the gaps left by failed uploads', () => {
    expect(missingFrameIndexes([0, 2, 3])).toEqual([1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(missingFrameIndexes(Array.from({ length: 16 }, (_, index) => index))).toEqual([]);
    expect(missingFrameIndexes([])).toHaveLength(16);
  });
});
