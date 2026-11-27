import { useCallback } from 'react';
import { useHost } from '../../host/HostProvider';
import type { RequestOptions } from '../../host/types';

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function useRequest() {
  const host = useHost();
  return useCallback(
    <T,>(path: string, options?: RequestOptions) => host.request<T>(path, options),
    [host],
  );
}
