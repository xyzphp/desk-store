import { useCallback } from 'react';
import { useHost } from '../../host/HostProvider';
import type { RequestOptions } from '../../host/types';

function resolveArticleRoute(suffix: string): string {
  if (!suffix) return '/articles';
  if (
    suffix === '/site' ||
    suffix.startsWith('/site/') ||
    suffix.startsWith('/site?') ||
    suffix === '/taxonomies' ||
    suffix.startsWith('/taxonomies/') ||
    suffix === '/files' ||
    suffix.startsWith('/files/')
  ) {
    return suffix;
  }
  return suffix.startsWith('/') ? `/articles${suffix}` : `/articles/${suffix}`;
}

export function useArticleRequest() {
  const host = useHost();
  return useCallback(
    <T = unknown,>(suffix: string, options?: RequestOptions) =>
      host.request<T>(resolveArticleRoute(suffix), options),
    [host],
  );
}
