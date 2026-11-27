import { useEffect, useMemo, useState, type ImgHTMLAttributes } from 'react';
import { backendFetch, base64ToBytes, RequestError } from './bridge';
import type { ArticleFile } from '../../features/articles/api';
import { articleFileId } from '../../features/articles/api';

interface CachedMedia {
  url: string;
  blob: Blob;
}

const mediaCache = new Map<number, CachedMedia>();
const inflight = new Map<number, Promise<CachedMedia>>();

function headerValue(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return '';
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name.toLowerCase()) return v;
  }
  return '';
}

export async function loadBackendMedia(fileId: number, signal?: AbortSignal): Promise<CachedMedia> {
  if (!Number.isSafeInteger(fileId) || fileId <= 0) {
    throw new Error('文件编号无效');
  }
  const existing = mediaCache.get(fileId);
  if (existing) return existing;

  let task = inflight.get(fileId);
  if (!task) {
    task = (async () => {
      const res = await backendFetch(`/files/content/${fileId}`, { method: 'GET' });
      if (!res || res.status >= 400) {
        throw new RequestError(`读取文件失败（HTTP ${res?.status ?? 500}）`, res?.status ?? 500);
      }
      const contentType =
        headerValue(res.headers, 'content-type').split(';')[0]?.trim() || 'application/octet-stream';
      const body = res.body ?? '';
      const bytes =
        res.encoding === 'base64' || res.bodyEncoding === 'base64'
          ? base64ToBytes(body)
          : new TextEncoder().encode(body);
      const blob = new Blob([bytes], { type: contentType });
      const entry: CachedMedia = { url: URL.createObjectURL(blob), blob };
      mediaCache.set(fileId, entry);
      return entry;
    })().finally(() => {
      inflight.delete(fileId);
    });
    inflight.set(fileId, task);
  }

  if (!signal) return task;
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  return new Promise<CachedMedia>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('已取消', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    task!.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

export async function fetchBackendFileBlob(fileId: number, signal?: AbortSignal): Promise<Blob> {
  const entry = await loadBackendMedia(fileId, signal);
  return entry.blob;
}

export function getCachedBackendFileUrl(fileId: number | undefined): string | undefined {
  if (!fileId || fileId <= 0) return undefined;
  return mediaCache.get(fileId)?.url;
}

export function clearMediaCache() {
  for (const entry of mediaCache.values()) {
    URL.revokeObjectURL(entry.url);
  }
  mediaCache.clear();
}

export async function downloadBackendFile(fileId: number, filename?: string): Promise<void> {
  const entry = await loadBackendMedia(fileId);
  const link = document.createElement('a');
  link.href = entry.url;
  link.download = filename || `file-${fileId}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function useBackendFileUrl(fileId: number | undefined, fallback?: string): string | undefined {
  const valid = typeof fileId === 'number' && Number.isSafeInteger(fileId) && fileId > 0 ? fileId : 0;
  const [url, setUrl] = useState<string | undefined>(() => (valid ? mediaCache.get(valid)?.url : fallback));

  useEffect(() => {
    if (!valid) {
      setUrl(fallback);
      return;
    }
    const cached = mediaCache.get(valid)?.url;
    if (cached) {
      setUrl(cached);
      return;
    }
    setUrl(undefined);
    const controller = new AbortController();
    void loadBackendMedia(valid, controller.signal)
      .then((entry) => {
        if (!controller.signal.aborted) setUrl(entry.url);
      })
      .catch(() => {
        if (!controller.signal.aborted) setUrl(fallback);
      });
    return () => controller.abort();
  }, [fallback, valid]);

  return url;
}

export function AppImage({
  fileId,
  fallbackSrc,
  onError,
  ...rest
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  fileId?: number;
  fallbackSrc?: string;
}) {
  const src = useBackendFileUrl(fileId, fallbackSrc);
  if (!src) return null;
  return <img src={src} onError={onError} {...rest} />;
}

export function useArticleMediaMap(files: readonly ArticleFile[]) {
  const [urls, setUrls] = useState<Record<number, string>>({});
  const idsKey = files
    .map((file) => `${file.id}:${file.mediaType}`)
    .sort()
    .join('|');

  useEffect(() => {
    const controller = new AbortController();
    const pendingIds: number[] = [];
    const initial: Record<number, string> = {};
    for (const file of files) {
      const id = articleFileId(file);
      if (!id) continue;
      if (file.mediaType.startsWith('image/')) {
        const cached = mediaCache.get(id)?.url;
        if (cached) initial[id] = cached;
        else pendingIds.push(id);
      }
    }
    setUrls((prev) => ({ ...prev, ...initial }));
    for (const id of pendingIds) {
      void loadBackendMedia(id, controller.signal)
        .then((entry) => {
          if (!controller.signal.aborted) {
            setUrls((prev) => (prev[id] === entry.url ? prev : { ...prev, [id]: entry.url }));
          }
        })
        .catch(() => undefined);
    }
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  return useMemo(() => {
    const map: Record<string, { url: string; image: boolean }> = {};
    for (const file of files) {
      const id = articleFileId(file);
      if (!id) continue;
      const isImage = file.mediaType.startsWith('image/');
      const url = isImage ? urls[id] || mediaCache.get(id)?.url || '' : `/files/content/${id}`;
      if (url) {
        map[`article-file:${id}`] = { url, image: isImage };
      }
    }
    return map;
  }, [files, urls]);
}
