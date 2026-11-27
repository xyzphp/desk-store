import { filesText } from './locale';
export interface ImagePreset {
  id: 'recommended' | 'compact' | 'qualityOnly' | 'original';
  name: string;
  detail: string;
  maxDimension: number;
  quality: number;
  forceJpeg: boolean;
}
/** 名称与说明按调用时的界面语言生成；在组件里调用并订阅 useLocale() 才会随语言切换更新。 */
export const imagePresets = (): readonly ImagePreset[] => [
  {
    id: 'recommended',
    name: filesText().presetRecommended,
    detail: filesText().presetRecommendedDetail,
    maxDimension: 2048,
    quality: 0.85,
    forceJpeg: true,
  },
  {
    id: 'compact',
    name: filesText().presetCompact,
    detail: filesText().presetCompactDetail,
    maxDimension: 1280,
    quality: 0.7,
    forceJpeg: true,
  },
  {
    id: 'qualityOnly',
    name: filesText().presetQuality,
    detail: filesText().presetQualityDetail,
    maxDimension: 0,
    quality: 0.9,
    forceJpeg: false,
  },
  {
    id: 'original',
    name: filesText().presetOriginal,
    detail: filesText().presetOriginalDetail,
    maxDimension: 0,
    quality: 1,
    forceJpeg: false,
  },
];
export interface PreparedImage {
  file: File;
  width: number;
  height: number;
  originalSize: number;
  compressed: boolean;
}

function imageAbortError() {
  return new DOMException(filesText().imageCancelled, 'AbortError');
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw imageAbortError();
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number | undefined, signal?: AbortSignal) {
  return new Promise<Blob>((resolve, reject) => {
    if (signal?.aborted) {
      reject(imageAbortError());
      return;
    }
    let settled = false;
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(imageAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    try {
      canvas.toBlob(
        (blob) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (blob) resolve(blob);
          else reject(new Error(filesText().encodeFailed));
        },
        type,
        quality,
      );
    } catch (failure) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(failure);
    }
  });
}

export async function inspectLocalImage(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

export function centerCropRect(source: { width: number; height: number }, target: { width: number; height: number }) {
  if (
    ![source.width, source.height, target.width, target.height].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) ||
    target.width > 4096 ||
    target.height > 4096 ||
    target.width * target.height > 4_000_000
  )
    throw new Error(filesText().coverSize);
  const scale = Math.max(target.width / source.width, target.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  return { x: (target.width - width) / 2, y: (target.height - height) / 2, width, height };
}

export async function cropCoverImage(source: Blob, target: { width: number; height: number }, signal: AbortSignal) {
  throwIfAborted(signal);
  if ((source.type !== 'image/png' && source.type !== 'image/jpeg') || source.size > 10 * 1024 * 1024)
    throw new Error(filesText().coverInvalid);
  const bitmap = await createImageBitmap(source);
  try {
    throwIfAborted(signal);
    const rect = centerCropRect(bitmap, target);
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error(filesText().coverCanvas);
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
    const blob = await canvasToBlob(canvas, 'image/png', undefined, signal);
    throwIfAborted(signal);
    if (blob.type !== 'image/png' || !blob.size || blob.size > 10 * 1024 * 1024)
      throw new Error(filesText().coverFailed);
    return blob;
  } finally {
    bitmap.close();
  }
}

export async function prepareImage(
  file: File,
  presetId: ImagePreset['id'],
  asJpeg: boolean,
  signal?: AbortSignal,
): Promise<PreparedImage> {
  const preset = imagePresets().find((item) => item.id === presetId)!;
  throwIfAborted(signal);
  if (preset.id === 'original') return { file, width: 0, height: 0, originalSize: file.size, compressed: false };
  const bitmap = await createImageBitmap(file);
  try {
    throwIfAborted(signal);
    const pixelScale = Math.min(1, Math.sqrt(11_500_000 / Math.max(1, bitmap.width * bitmap.height)));
    const presetScale = preset.maxDimension
      ? Math.min(1, preset.maxDimension / Math.max(bitmap.width, bitmap.height))
      : 1;
    const ratio = Math.min(pixelScale, presetScale);
    const width = Math.max(1, Math.floor(bitmap.width * ratio)),
      height = Math.max(1, Math.floor(bitmap.height * ratio));
    const png = file.type === 'image/png' && !preset.forceJpeg && !asJpeg;
    const type = png ? 'image/png' : 'image/jpeg';
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: png });
    if (!context) throw new Error(filesText().canvas);
    if (!png) {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    let quality = preset.quality;
    let blob = await canvasToBlob(canvas, type, png ? undefined : quality, signal);
    for (const next of [0.78, 0.68, 0.58, 0.48, 0.38]) {
      if (png || blob.size < file.size || quality <= 0.38) break;
      throwIfAborted(signal);
      quality = next;
      blob = await canvasToBlob(canvas, type, quality, signal);
    }
    throwIfAborted(signal);
    if (blob.size >= file.size && width === bitmap.width && height === bitmap.height && type === file.type)
      return { file, width, height, originalSize: file.size, compressed: false };
    const base =
      file.name
        .replace(/\.[^.]*$/, '')
        .replace(/[\/\\:\x00]/g, '_')
        .slice(0, 100) || 'image';
    return {
      file: new File([blob], base + (png ? '.png' : '.jpg'), { type, lastModified: Date.now() }),
      width,
      height,
      originalSize: file.size,
      compressed: true,
    };
  } finally {
    bitmap.close();
  }
}
