import { describe, it, expect } from 'vitest';
import type { Capture } from '../../../../CONTRACTS/types';
import {
  COMPASS_TOLERANCE_DEG,
  STEP_DEG,
  TOTAL_FRAMES,
  canRetry,
  captureErrorHint,
  captureStateLabel,
  compassGuidance,
  detectCameraSupport,
  detectOrientationSupport,
  frameFileName,
  isSeriesComplete,
  nextFrameIndex,
  shootingProgress,
  shortAngle,
  targetAngleFor,
} from './guide';

function makeCapture(overrides: Partial<Capture> = {}): Capture {
  return {
    id: 'capture-1',
    map_id: 'map-1',
    title: 'Зал',
    x: 100,
    y: 100,
    hfov_hint_deg: 65,
    state: 'collecting',
    progress: 0,
    attempt: 0,
    frames: [],
    result_asset_id: null,
    error_code: null,
    error_message: null,
    created_at: '2026-10-24T08:00:00Z',
    updated_at: '2026-10-24T08:00:00Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

describe('capture guide maths', () => {
  it('uses a 16 frame series with a 22.5 degree step', () => {
    expect(TOTAL_FRAMES).toBe(16);
    expect(STEP_DEG).toBe(22.5);
    expect(16 * 22.5).toBe(360);
  });

  it('computes the target angle for every frame and wraps the last one', () => {
    expect(targetAngleFor(0)).toBe(0);
    expect(targetAngleFor(1)).toBe(22.5);
    expect(targetAngleFor(8)).toBe(180);
    expect(targetAngleFor(15)).toBe(337.5);
    expect(targetAngleFor(16)).toBe(0);
  });

  it('normalizes angles so the guide never asks for a 340 degree turn', () => {
    expect(shortAngle(370)).toBe(10);
    expect(shortAngle(-10)).toBe(-10);
    expect(shortAngle(350)).toBe(-10);
    expect(shortAngle(180)).toBe(-180);
  });

  it('tells the organizer which way to turn and when the target is reached', () => {
    const right = compassGuidance(45, 10);
    expect(right.direction).toBe('right');
    expect(right.delta).toBe(35);
    expect(right.aligned).toBe(false);
    expect(right.text).toContain('вправо');
    expect(right.text).toContain('35');

    const left = compassGuidance(45, 90);
    expect(left.direction).toBe('left');
    expect(left.text).toContain('влево');

    const aligned = compassGuidance(45, 45 + COMPASS_TOLERANCE_DEG - 1);
    expect(aligned.aligned).toBe(true);
    expect(aligned.direction).toBe('hold');
    expect(aligned.text).toContain('можно снимать');
  });

  it('falls back gracefully when the compass is unavailable', () => {
    const guidance = compassGuidance(90, null);
    expect(guidance.aligned).toBe(false);
    expect(guidance.direction).toBe('unknown');
    expect(guidance.text).toContain('Компас недоступен');
  });
});

describe('capture environment detection', () => {
  it('requires HTTPS for camera capture', () => {
    const scope = {
      isSecureContext: false,
      navigator: { mediaDevices: { getUserMedia: () => Promise.resolve() } },
    } as unknown as Window;
    const support = detectCameraSupport(scope);
    expect(support.usable).toBe(false);
    expect(support.httpsRequired).toBe(true);
    expect(support.reason).toContain('HTTPS');
  });

  it('reports an unsupported browser without mediaDevice', () => {
    const scope = { isSecureContext: true, navigator: {} } as unknown as Window;
    expect(detectCameraSupport(scope)).toMatchObject({ usable: false, httpsRequired: false });
  });

  it('enables capture on a secure context with getUserMedia', () => {
    const scope = {
      isSecureContext: true,
      navigator: { mediaDevices: { getUserMedia: () => Promise.resolve() } },
    } as unknown as Window;
    expect(detectCameraSupport(scope)).toEqual({ usable: true, reason: null, httpsRequired: false });
  });

  it('detects the iOS orientation permission gate', () => {
    const ios = { DeviceOrientationEvent: { requestPermission: () => Promise.resolve('granted') } } as unknown as Window;
    const android = { DeviceOrientationEvent: function DeviceOrientationEvent() {} } as unknown as Window;
    const none = {} as unknown as Window;
    expect(detectOrientationSupport(ios)).toBe('permission-needed');
    expect(detectOrientationSupport(android)).toBe('supported');
    expect(detectOrientationSupport(none)).toBe('unsupported');
    expect(detectOrientationSupport(null)).toBe('unsupported');
  });
});

describe('capture progress helpers', () => {
  it('resumes from the first missing frame, not from the count', () => {
    expect(nextFrameIndex([])).toBe(0);
    expect(nextFrameIndex([{ index: 0 }, { index: 1 }])).toBe(2);
    // A gap left by a failed upload is filled first.
    expect(nextFrameIndex([{ index: 0 }, { index: 2 }])).toBe(1);
    expect(nextFrameIndex(Array.from({ length: 16 }, (_, index) => ({ index })))).toBe(16);
  });

  it('keeps shooting progress below 100 percent', () => {
    expect(shootingProgress([])).toBe(0);
    expect(shootingProgress(Array.from({ length: 8 }, (_, index) => ({ index })))).toBe(48);
    expect(shootingProgress(Array.from({ length: 16 }, (_, index) => ({ index })))).toBe(95);
  });

  it('knows when the series is complete', () => {
    expect(isSeriesComplete([])).toBe(false);
    expect(isSeriesComplete(Array.from({ length: 16 }, (_, index) => ({ index })))).toBe(true);
  });

  it('formats frame file names', () => {
    expect(frameFileName(3)).toBe('capture-frame-03.jpg');
  });
});

describe('server job presentation', () => {
  it('describes every capture state for the organizer', () => {
    expect(captureStateLabel(null)).toBe('Сессия не создана');
    expect(captureStateLabel(makeCapture({ frames: [{ index: 0, sha256: '', width_px: 1, height_px: 1 }] }))).toContain(
      '1/16',
    );
    expect(captureStateLabel(makeCapture({ state: 'queued', attempt: 1 }))).toContain('очеред');
    expect(captureStateLabel(makeCapture({ state: 'running', progress: 42 }))).toContain('42%');
    expect(captureStateLabel(makeCapture({ state: 'succeeded', progress: 100 }))).toContain('готова');
    expect(captureStateLabel(makeCapture({ state: 'failed', error_code: 'TIMEOUT' }))).toContain('TIMEOUT');
    expect(captureStateLabel(makeCapture({ state: 'cancelled' }))).toContain('отменена');
  });

  it('always offers a recovery action for a failed job', () => {
    expect(captureErrorHint('NOT_ENOUGH_OVERLAP')).toContain('перекрытия');
    expect(captureErrorHint('INSUFFICIENT_COVERAGE')).toContain('не полностью');
    expect(captureErrorHint('WORKER_LOST')).toContain('повторно');
    expect(captureErrorHint('SOMETHING_NEW')).toContain('Повторите склейку');
    expect(captureErrorHint(null)).toContain('Повторите склейку');
  });

  it('allows a retry only below the two attempt limit', () => {
    expect(canRetry(null)).toBe(false);
    expect(canRetry(makeCapture({ state: 'failed', attempt: 1, error_code: 'TIMEOUT' }))).toBe(true);
    expect(canRetry(makeCapture({ state: 'failed', attempt: 2, error_code: 'TIMEOUT' }))).toBe(false);
    expect(canRetry(makeCapture({ state: 'running', attempt: 1 }))).toBe(false);
  });
});
