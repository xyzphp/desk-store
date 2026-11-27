import { setCurrentLocale } from '../i18n/current';
import type { PickedPlatformFile, SavedPlatformFile } from '../../host/types';

export interface InitContext {
  appId?: string;
  user?: { id?: number; displayName?: string };
  permissions?: string[];
  locale?: string;
  theme?: { theme?: string; accent?: string };
}

export interface BackendResponse {
  ok?: boolean;
  status: number;
  headers?: Record<string, string>;
  body?: string;
  encoding?: 'text' | 'base64';
  bodyEncoding?: 'text' | 'base64';
}

export class RequestError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
  }
}

const host = typeof window !== 'undefined' && window.parent !== window ? window.parent : null;
const hostOrigin = (() => {
  if (typeof window === 'undefined') return '';
  try {
    return new URL(document.baseURI, window.location.href).origin;
  } catch {
    return window.location.origin;
  }
})();

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

const pending = new Map<string, PendingCall>();
const listeners = new Map<string, Set<(data: unknown) => void>>();
let context: InitContext | null = null;
let sequence = 0;

function emit(event: string, data: unknown) {
  for (const listener of listeners.get(event) ?? []) {
    try {
      listener(data);
    } catch {
      /* ignore listener errors */
    }
  }
}

function applyTheme(theme: unknown) {
  if (!theme || typeof theme !== 'object') return;
  const t = theme as { theme?: unknown; accent?: unknown };
  if (t.theme === 'light' || t.theme === 'dark') {
    document.documentElement.dataset.theme = t.theme;
  }
  if (typeof t.accent === 'string' && t.accent) {
    document.documentElement.style.setProperty('--accent', t.accent);
  }
}

function applyLocale(value: unknown) {
  if (typeof value === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value)) {
    setCurrentLocale(value);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    const message = event.data as {
      __xyzos?: number;
      id?: string;
      result?: unknown;
      error?: string;
      event?: string;
      data?: unknown;
    } | null;
    if (event.source !== host || event.origin !== hostOrigin || !message || message.__xyzos !== 1) return;
    if (message.id !== undefined && pending.has(message.id)) {
      const req = pending.get(message.id)!;
      pending.delete(message.id);
      if (message.error) req.reject(new Error(message.error));
      else req.resolve(message.result);
      return;
    }
    if (message.event === 'init') {
      context = (message.data && typeof message.data === 'object' ? (message.data as InitContext) : {}) ?? {};
      applyTheme(context.theme);
      applyLocale(context.locale);
      emit('init', context);
    } else if (message.event === 'theme') {
      applyTheme(message.data);
      emit('theme', message.data);
    } else if (message.event === 'locale') {
      applyLocale(message.data);
      emit('locale', message.data);
    } else if (message.event) {
      emit(message.event, message.data);
    }
  });

  let lastActivity = 0;
  for (const name of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
    document.addEventListener(
      name,
      (event) => {
        if (!context || !event.isTrusted || Date.now() - lastActivity < 1000) return;
        lastActivity = Date.now();
        void call('activity').catch(() => undefined);
      },
      { capture: true, passive: true },
    );
  }
}

export function inHostFrame(): boolean {
  return host !== null;
}

export function currentContext(): InitContext | null {
  return context;
}

export function onHostEvent(event: string, listener: (data: unknown) => void): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(listener);
  if (event === 'init' && context) {
    queueMicrotask(() => listener(context));
  }
  return () => {
    set?.delete(listener);
  };
}

export function call(method: string, args?: unknown, signal?: AbortSignal): Promise<unknown> {
  if (!host) return Promise.reject(new Error('请在桌面环境中打开本应用'));
  if (signal?.aborted) return Promise.reject(new DOMException('已取消', 'AbortError'));
  return new Promise((resolve, reject) => {
    const id = `r${++sequence}`;
    const onAbort = () => {
      if (pending.delete(id)) reject(new DOMException('已取消', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    pending.set(id, {
      resolve: (value) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      },
      reject: (reason) => {
        signal?.removeEventListener('abort', onAbort);
        reject(reason);
      },
    });
    host.postMessage({ __xyzos: 1, id, method, args }, hostOrigin);
  });
}

export function platformCall(
  capability: string,
  action: string,
  payload?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  return call('platform', { capability, action, payload }, signal);
}

export async function bytesToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const raw = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function backendFetch(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<BackendResponse> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let body = '';
  const bodyEncoding: 'text' | 'base64' = 'text';
  if (typeof options.body === 'string') {
    body = options.body;
  } else if (options.body !== undefined && options.body !== null) {
    body = JSON.stringify(options.body);
    if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
  }
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const res = (await call(
    'backend',
    {
      path: normalized,
      method: options.method ?? 'GET',
      headers,
      body,
      bodyEncoding,
    },
    options.signal,
  )) as BackendResponse;
  return res;
}

export async function backendJSON<T>(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
    fallbackError?: string;
  } = {},
): Promise<T> {
  const res = await backendFetch(path, options);
  let text = res?.body ?? '';
  if (text && (res.encoding === 'base64' || res.bodyEncoding === 'base64')) {
    text = new TextDecoder().decode(base64ToBytes(text));
  }
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res || res.status >= 400) {
    const serverErr =
      parsed && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error?: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : '';
    throw new RequestError(
      serverErr || options.fallbackError || `请求失败（HTTP ${res?.status ?? 500}）`,
      res?.status ?? 500,
    );
  }
  return parsed as T;
}

export const platformIdentityMe = () =>
  platformCall('identity', 'me') as Promise<{ id: number; displayName: string }>;

export const platformConfirm = (options: {
  title: string;
  message: string;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
}) => platformCall('ui', 'confirm', options) as Promise<boolean>;

export const platformAlert = (options: { title: string; message: string }) =>
  platformCall('ui', 'alert', options) as Promise<void>;

export const platformOpenPublicSite = (path = '') =>
  platformCall('ui', 'openPublicSite', { path }) as Promise<boolean>;

export const platformWorkspaceGet = () => platformCall('workspace.state', 'get');
export const platformWorkspaceSave = (state: unknown) => platformCall('workspace.state', 'save', state);

export const platformFilesPick = () =>
  platformCall('files.pick', 'pick') as Promise<PickedPlatformFile | null>;

export async function platformFilesSave(
  file: Blob,
  name: string,
  refKey = 'article:temp',
): Promise<SavedPlatformFile> {
  const dataBase64 = await bytesToBase64(file);
  return (await platformCall('files.save', 'save', {
    name,
    dataBase64,
    refKey,
  })) as SavedPlatformFile;
}

export const platformSettingsGet = (signal?: AbortSignal) =>
  platformCall('settings', 'get', undefined, signal) as Promise<Record<string, unknown>>;

export const platformAIComplete = (
  payload: {
    system?: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    maxOutput?: number;
    responseFormat?: 'text' | 'json';
  },
  signal?: AbortSignal,
) =>
  platformCall('ai.complete', 'complete', payload, signal) as Promise<{
    text: string;
    model?: string;
    usage?: { inputTokens?: number; outputTokens?: number };
  }>;

export const platformAIImage = (
  payload: {
    prompt: string;
    size?: string;
    quality?: string;
  },
  signal?: AbortSignal,
) =>
  platformCall('ai.image', 'generate', payload, signal) as Promise<{
    mediaType?: string;
    width?: number;
    height?: number;
    dataBase64?: string;
    path?: string;
  }>;
