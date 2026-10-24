import type { Capture } from '../../../../CONTRACTS/types';

export const TOTAL_FRAMES = 16;
export const STEP_DEG = 22.5;
export const FULL_TURN_DEG = 360;
export const COMPASS_TOLERANCE_DEG = 8;

export type CapturePhase =
  | 'idle'
  | 'preparing'
  | 'capturing'
  | 'reviewing'
  | 'uploading'
  | 'queued';

export interface CameraSupport {
  usable: boolean;
  /** Reason a camera flow cannot start, already phrased for the organizer. */
  reason: string | null;
  httpsRequired: boolean;
}

export interface CompassGuidance {
  delta: number | null;
  aligned: boolean;
  direction: 'left' | 'right' | 'hold' | 'unknown';
  text: string;
}

/** Angle the organizer should be facing for the given frame. */
export function targetAngleFor(index: number): number {
  return (index * STEP_DEG) % FULL_TURN_DEG;
}

/** Normalizes an angle into -180..180 so the guide never says "turn 340°". */
export function shortAngle(value: number): number {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return wrapped === 180 ? -180 : wrapped;
}

/**
 * Compares the phone heading with the angle of the next frame.
 * `aligned` is true inside the tolerance so the shutter unlocks.
 */
export function compassGuidance(
  targetDeg: number,
  headingDeg: number | null,
  toleranceDeg: number = COMPASS_TOLERANCE_DEG,
): CompassGuidance {
  if (headingDeg === null || !Number.isFinite(headingDeg)) {
    return {
      delta: null,
      aligned: false,
      direction: 'unknown',
      text: 'Компас недоступен — держите телефон вертикально и поворачивайтесь на шаг 22,5°',
    };
  }
  const delta = shortAngle(targetDeg - headingDeg);
  const aligned = Math.abs(delta) <= toleranceDeg;
  if (aligned) {
    return { delta, aligned: true, direction: 'hold', text: 'Ориентир совпал — можно снимать' };
  }
  const direction = delta > 0 ? 'right' : 'left';
  return {
    delta,
    aligned: false,
    direction,
    text: `Повернитесь ${direction === 'right' ? 'вправо' : 'влево'} на ${Math.abs(Math.round(delta))}°`,
  };
}

/** Camera availability, including the HTTPS rule browsers enforce on phones. */
export function detectCameraSupport(scope: Window | null = typeof window === 'undefined' ? null : window): CameraSupport {
  if (!scope) {
    return { usable: false, reason: 'Камера доступна только в браузере', httpsRequired: false };
  }
  const mediaDevices = scope.navigator?.mediaDevices;
  const canUse = typeof mediaDevices?.getUserMedia === 'function';
  const secure = scope.isSecureContext !== false;
  // Browsers hide `navigator.mediaDevices` entirely on an insecure origin, so
  // the HTTPS rule has to be checked before the capability check.
  if (!secure) {
    return {
      usable: false,
      reason: 'Для съёмки нужен HTTPS: откройте карту по защищённой ссылке или загрузите готовую сферу 2:1',
      httpsRequired: true,
    };
  }
  if (!canUse) {
    return {
      usable: false,
      reason: 'Браузер не поддерживает доступ к камере',
      httpsRequired: false,
    };
  }
  return { usable: true, reason: null, httpsRequired: false };
}

export type OrientationSupport = 'supported' | 'permission-needed' | 'unsupported';

export function detectOrientationSupport(
  scope: Window | null = typeof window === 'undefined' ? null : window,
): OrientationSupport {
  const orientation = (scope as unknown as { DeviceOrientationEvent?: { requestPermission?: unknown } } | null)
    ?.DeviceOrientationEvent;
  if (!scope || typeof orientation === 'undefined') return 'unsupported';
  const requestPermission = orientation.requestPermission;
  return typeof requestPermission === 'function' ? 'permission-needed' : 'supported';
}

export interface FrameLike {
  index: number;
}

/** First frame slot that still has to be uploaded (0..15). */
export function nextFrameIndex(frames: FrameLike[], total: number = TOTAL_FRAMES): number {
  const taken = new Set(frames.map((frame) => frame.index));
  for (let index = 0; index < total; index += 1) {
    if (!taken.has(index)) return index;
  }
  return total;
}

export function isSeriesComplete(frames: FrameLike[], total: number = TOTAL_FRAMES): boolean {
  return frames.length >= total;
}

/** Shooting progress in percent, never reaching 100 before the stitch is queued. */
export function shootingProgress(frames: FrameLike[], total: number = TOTAL_FRAMES): number {
  return Math.min(95, Math.round((frames.length / total) * 95));
}

export const CAPTURE_PHASE_LABELS: Record<CapturePhase, string> = {
  idle: 'Готово к съёмке',
  preparing: 'Готовим камеру',
  capturing: 'Съёмка серии',
  reviewing: 'Проверьте кадр',
  uploading: 'Загрузка кадров',
  queued: 'Склейка на сервере',
};

/** Human readable state of the server job. */
export function captureStateLabel(capture: Capture | null): string {
  if (!capture) return 'Сессия не создана';
  switch (capture.state) {
    case 'collecting':
      return `Съёмка: ${capture.frames.length}/${TOTAL_FRAMES} кадров`;
    case 'queued':
      return 'В очереди на склейку';
    case 'running':
      return `Склейка: ${capture.progress}%`;
    case 'succeeded':
      return 'Панорама готова';
    case 'failed':
      return `Ошибка склейки (${capture.error_code ?? 'UNKNOWN'})`;
    case 'cancelled':
      return 'Съёмка отменена';
    default:
      return capture.state;
  }
}

const ERROR_HINTS: Record<string, string> = {
  INPUT_EXPIRED: 'Кадры серии устарели: переснимите панораму или загрузите готовую сферу 2:1.',
  NOT_ENOUGH_OVERLAP: 'Мало перекрытия: повторите серию с шагом 22,5° и без пропусков.',
  LOOP_NOT_CLOSED: 'Не замкнулось кольцо: последний кадр должен перекрывать первый.',
  INSUFFICIENT_COVERAGE: 'Сфера покрыта не полностью: держите телефон ровно, без наклона в пол.',
  QUALITY_REJECTED: 'Склейка не прошла контроль качества: переснимите серию или загрузите готовую сферу.',
  TIMEOUT: 'Склейка превысила лимит времени: повторите позже или загрузите готовую сферу.',
  WORKER_LOST: 'Сервер потерял задачу: поставьте склейку в очередь повторно.',
  TOOL_FAILED: 'Инструменты склейки недоступны: загрузите готовую сферу 2:1.',
};

/** Recovery action shown next to a failed job; never leaves the organizer stuck. */
export function captureErrorHint(code: string | null | undefined): string {
  if (!code) return 'Повторите склейку или загрузите готовую панораму.';
  return ERROR_HINTS[code] ?? 'Повторите склейку или загрузите готовую панораму.';
}

export function canRetry(capture: Capture | null): boolean {
  if (!capture) return false;
  return capture.state === 'failed' && capture.attempt < 2;
}

export function frameFileName(index: number): string {
  return `capture-frame-${String(index).padStart(2, '0')}.jpg`;
}
