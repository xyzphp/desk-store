import { pickMessages, type MessageCatalog } from '@xyzos/desk-ui';

let activeLocale =
  typeof document !== 'undefined' && document.documentElement.lang ? document.documentElement.lang : 'zh-CN';
const listeners = new Set<(locale: string) => void>();

export function currentLocale(): string {
  return activeLocale;
}

export function setCurrentLocale(locale: string) {
  if (!locale || locale === activeLocale) return;
  activeLocale = locale;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
  for (const listener of listeners) listener(locale);
}

export function subscribeLocale(listener: (locale: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentMessages<T>(catalog: MessageCatalog<T>): T {
  return pickMessages(catalog, activeLocale);
}
