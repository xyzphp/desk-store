import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'apps'; category?: string }
  | { name: 'app'; slug: string }
  | { name: 'docs'; section?: string; page?: string }
  | { name: 'missing' };

/** 解析 hash 路由：#/、#/apps、#/apps/<slug>、#/docs/<section>/<page>。 */
export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'apps') {
    if (parts.length === 1) return { name: 'apps', category: new URLSearchParams(query).get('category') ?? undefined };
    if (parts.length === 2) return { name: 'app', slug: parts[1]! };
  }
  if (parts[0] === 'docs' && parts.length <= 3) return { name: 'docs', section: parts[1], page: parts[2] };
  return { name: 'missing' };
}

export function href(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'apps':
      return route.category ? `#/apps?category=${encodeURIComponent(route.category)}` : '#/apps';
    case 'app':
      return `#/apps/${encodeURIComponent(route.slug)}`;
    case 'docs':
      return ['#/docs', route.section, route.page].filter(Boolean).join('/');
    default:
      return '#/';
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const update = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}

export function navigate(route: Route) {
  window.location.hash = href(route);
}
