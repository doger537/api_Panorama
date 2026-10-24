import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { detectCameraSupport } from './guide';
import { encodeVideoFrame } from './frame';

/** Owns the stream independently of the preview's video element. */
export function useCaptureCamera() {
  const support = useMemo(() => detectCameraSupport(), []);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const requestRef = useRef(0);
  const detachTracksRef = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const release = useCallback(() => {
    requestRef.current += 1;
    detachTracksRef.current?.();
    detachTracksRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    release();
    setReady(false);
  }, [release]);

  useEffect(() => release, [release]);

  const bindVideo = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
    if (video) video.srcObject = streamRef.current;
  }, []);

  const updateReady = useCallback(() => {
    const video = videoRef.current;
    setReady(Boolean(streamRef.current && video && video.readyState >= 2 && video.videoWidth && video.videoHeight));
  }, []);

  const start = useCallback(async () => {
    stop();
    setError(null);
    if (!support.usable) {
      setError(support.reason);
      return false;
    }
    const request = requestRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1440 }, height: { ideal: 1920 } },
        audio: false,
      });
      if (request !== requestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      streamRef.current = stream;
      const ended = () => {
        if (streamRef.current !== stream) return;
        stop();
        setError('Камера остановилась. Отмените съёмку или откройте камеру снова.');
      };
      stream.getVideoTracks().forEach((track) => track.addEventListener('ended', ended));
      detachTracksRef.current = () => {
        stream.getVideoTracks().forEach((track) => track.removeEventListener('ended', ended));
      };
      if (videoRef.current) videoRef.current.srcObject = stream;
      setReady(false);
      return true;
    } catch {
      if (request === requestRef.current) {
        setError('Не удалось открыть камеру. Разрешите доступ в браузере или загрузите готовую сферу 2:1.');
      }
      return false;
    }
  }, [stop, support]);

  const capture = useCallback((index: number) => {
    if (!streamRef.current) return Promise.reject(new Error('Камера остановилась. Откройте её снова.'));
    return encodeVideoFrame(videoRef.current, index);
  }, []);
  return { active: streamRef.current !== null, support, ready, error, start, stop, bindVideo, updateReady, capture };
}
