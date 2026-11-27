import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ConfigProvider } from '@xyzos/desk-ui';
import {
  backendJSON,
  currentContext,
  inHostFrame,
  onHostEvent,
  platformFilesPick,
  platformFilesSave,
  platformIdentityMe,
  platformOpenPublicSite,
  type InitContext,
} from '../shared/sdk/bridge';
import { clearMediaCache, fetchBackendFileBlob } from '../shared/sdk/media';
import { currentLocale, subscribeLocale } from '../shared/i18n/current';
import type { HostSession, OsHost, RequestOptions } from './types';

function mapBackendPath(path: string): string {
  const clean = path.trim();
  if (clean.startsWith('articles/')) {
    const rest = clean.slice('articles'.length);
    if (rest.startsWith('/site') || rest.startsWith('/taxonomies') || rest.startsWith('/files')) return rest;
    return `/articles${rest}`;
  }
  if (clean === 'articles') return '/articles';
  if (clean.startsWith('/')) return clean;
  return `/${clean}`;
}

function createUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, '0');
}

const HostContext = createContext<OsHost | null>(null);
const SessionContext = createContext<HostSession>({ status: 'loading', generation: 0 });

export function AppHostProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState(() => currentLocale());
  const [session, setSession] = useState<HostSession>({ status: 'loading', generation: 0 });
  const sessionRef = useRef<HostSession>(session);
  sessionRef.current = session;

  useEffect(() => subscribeLocale(setLocale), []);

  useEffect(() => {
    let active = true;
    const applyInit = async (raw: unknown) => {
      const ctx = (raw && typeof raw === 'object' ? (raw as InitContext) : currentContext()) ?? {};
      const perms = Array.isArray(ctx.permissions) ? ctx.permissions.filter((p): p is string => typeof p === 'string') : [];
      let id = typeof ctx.user?.id === 'number' ? ctx.user.id : 0;
      let displayName = typeof ctx.user?.displayName === 'string' ? ctx.user.displayName : '';
      if (id <= 0 && inHostFrame()) {
        try {
          const me = await platformIdentityMe();
          if (me && typeof me.id === 'number') {
            id = me.id;
            displayName = me.displayName || displayName;
          }
        } catch {
          /* fallback when identity unavailable */
        }
      }
      if (!active) return;
      const next: HostSession = {
        status: 'ready',
        generation: sessionRef.current.generation + 1,
        user: {
          id: id || 1,
          displayName: displayName || '作者',
          isAdmin: perms.includes('site.settings'),
          apps: ['article-management'],
          permissions: perms,
        },
      };
      sessionRef.current = next;
      setSession(next);
    };

    const offInit = onHostEvent('init', (data) => {
      void applyInit(data);
    });
    const offLock = onHostEvent('lock', () => {
      clearMediaCache();
      setSession((prev) => ({ status: 'locked', generation: prev.generation + 1 }));
    });
    return () => {
      active = false;
      offInit();
      offLock();
      clearMediaCache();
    };
  }, []);

  const host = useMemo<OsHost>(
    () => ({
      getSession: () => sessionRef.current,
      request<T>(path: string, options: RequestOptions = {}) {
        const mapped = mapBackendPath(path);
        return backendJSON<T>(mapped, {
          method: options.method ?? 'GET',
          headers: options.headers,
          body: options.body,
          signal: options.signal,
          fallbackError: options.fallbackError,
        });
      },
      async upload<T>(_path: string, body: FormData, options: RequestOptions = {}) {
        const raw = body.get('file');
        if (!(raw instanceof Blob)) throw new Error(options.fallbackError || '上传文件无效');
        const filename = raw instanceof File && raw.name ? raw.name : `upload-${Date.now()}`;
        const saved = await platformFilesSave(raw, filename, 'article:temp');
        const registered = await backendJSON<{ ok: boolean; file: unknown }>('/files/register', {
          method: 'POST',
          body: {
            fileId: saved.fileId,
            name: saved.name || filename,
            mediaType: saved.mediaType || raw.type || 'application/octet-stream',
            size: saved.size || raw.size,
            width: saved.width || 0,
            height: saved.height || 0,
          },
          signal: options.signal,
          fallbackError: options.fallbackError,
        });
        return registered as unknown as T;
      },
      async readBlob(path: string, options: RequestOptions = {}) {
        const match = /\/files\/content\/([1-9]\d*)/.exec(path);
        if (match) {
          return fetchBackendFileBlob(Number(match[1]), options.signal);
        }
        throw new Error(options.fallbackError || '无法读取文件');
      },
      async requestEvents() {
        throw new Error('应用内请使用平台 AI 能力');
      },
      uuid: createUUID,
      openApp() {
        return false;
      },
      async openPublicSite(path = '') {
        await platformOpenPublicSite(path);
      },
      pickPlatformFile: () => platformFilesPick(),
      savePlatformFile: (file, name, refKey) =>
        platformFilesSave(file, name || (file instanceof File ? file.name : `file-${Date.now()}`), refKey),
      fileLibrary: {
        changed() {
          /* 文件库引用由平台托管，无需跨窗口广播 */
        },
      },
    }),
    [],
  );

  return (
    <ConfigProvider locale={locale}>
      <HostContext.Provider value={host}>
        <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
      </HostContext.Provider>
    </ConfigProvider>
  );
}

export function useHost(): OsHost {
  const ctx = useContext(HostContext);
  if (!ctx) throw new Error('AppHostProvider missing');
  return ctx;
}

export function useSession(): HostSession {
  return useContext(SessionContext);
}
