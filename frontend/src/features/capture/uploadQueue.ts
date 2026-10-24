/**
 * Sequential frame upload with bounded retries.
 *
 * 16 frames go to the server one by one on a mobile connection; a single
 * failed request must not lose the whole series, so every frame is retried a
 * couple of times with a small backoff before the organizer is asked to act.
 */

export interface UploadQueueOptions<T> {
  upload: (index: number) => Promise<T>;
  /** Frame indexes to upload, in order. */
  indexes: number[];
  attemptsPerFrame?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onFrameUploaded?: (index: number, result: T) => void;
  onFrameFailed?: (index: number, error: unknown, attempt: number) => void;
  isCancelled?: () => boolean;
}

export interface UploadQueueResult<T> {
  uploaded: number[];
  failedIndex: number | null;
  error: unknown;
  lastResult: T | null;
  cancelled: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const DEFAULT_ATTEMPTS = 3;
export const DEFAULT_RETRY_DELAY_MS = 400;

export async function uploadFrameWithRetry<T>(
  upload: () => Promise<T>,
  options: {
    attempts?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
    onAttemptFailed?: (error: unknown, attempt: number) => void;
  } = {},
): Promise<{ ok: true; value: T; attempts: number } | { ok: false; error: unknown; attempts: number }> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const delayMs = options.delayMs ?? DEFAULT_RETRY_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return { ok: true, value: await upload(), attempts: attempt };
    } catch (error) {
      lastError = error;
      options.onAttemptFailed?.(error, attempt);
      if (attempt < attempts && delayMs > 0) {
        await sleep(delayMs * attempt);
      }
    }
  }
  return { ok: false, error: lastError, attempts };
}

/** Uploads frames strictly in order and stops at the first unrecoverable frame. */
export async function uploadFramesSequentially<T>(options: UploadQueueOptions<T>): Promise<UploadQueueResult<T>> {
  const {
    upload,
    indexes,
    attemptsPerFrame = DEFAULT_ATTEMPTS,
    delayMs = DEFAULT_RETRY_DELAY_MS,
    sleep,
    onFrameUploaded,
    onFrameFailed,
    isCancelled,
  } = options;

  const uploaded: number[] = [];
  let lastResult: T | null = null;

  for (const index of indexes) {
    if (isCancelled?.()) {
      return { uploaded, failedIndex: null, error: null, lastResult, cancelled: true };
    }
    const outcome = await uploadFrameWithRetry(() => upload(index), {
      attempts: attemptsPerFrame,
      delayMs,
      sleep,
      onAttemptFailed: (error, attempt) => onFrameFailed?.(index, error, attempt),
    });
    if (!outcome.ok) {
      return { uploaded, failedIndex: index, error: outcome.error, lastResult, cancelled: false };
    }
    lastResult = outcome.value;
    uploaded.push(index);
    onFrameUploaded?.(index, outcome.value);
  }

  return { uploaded, failedIndex: null, error: null, lastResult, cancelled: false };
}

/** Indexes still missing on the server, in upload order. */
export function missingFrameIndexes(present: number[], total = 16): number[] {
  const taken = new Set(present);
  const missing: number[] = [];
  for (let index = 0; index < total; index += 1) {
    if (!taken.has(index)) missing.push(index);
  }
  return missing;
}
