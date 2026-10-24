import { frameFileName } from './guide';

/** The capture API accepts at most 1600 pixels on either side. */
const MAX_FRAME_SIDE = 1600;

export async function encodeVideoFrame(video: HTMLVideoElement | null, index: number): Promise<File> {
  if (!video || video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) {
    throw new Error('Камера ещё не готова к снимку. Дождитесь живого изображения.');
  }
  const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Браузер не смог подготовить снимок. Попробуйте ещё раз.');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value?.size) resolve(value);
      else reject(new Error('Не удалось сохранить кадр. Попробуйте снять его ещё раз.'));
    }, 'image/jpeg', 0.9);
  });
  return new File([blob], frameFileName(index), { type: 'image/jpeg' });
}
