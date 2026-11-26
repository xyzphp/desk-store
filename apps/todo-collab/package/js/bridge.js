// 与桌面壳通信的最小客户端：支持平台接口 v1 与格式 2 后端模块调用。
const host = window.parent !== window ? window.parent : null;
const hostOrigin = new URL(document.baseURI).origin;
const pending = new Map();
const listeners = new Map();
let context = null;
let sequence = 0;

function emit(event, data) {
  for (const listener of listeners.get(event) ?? []) listener(data);
}

window.addEventListener('message', (event) => {
  const message = event.data;
  if (event.source !== host || event.origin !== hostOrigin || !message || message.__xyzos !== 1) return;
  if (message.id !== undefined && pending.has(message.id)) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.result);
    return;
  }
  if (message.event === 'init') {
    context = message.data;
    applyTheme(context.theme);
    applyLocale(context.locale);
    emit('init', context);
  } else if (message.event === 'theme') {
    applyTheme(message.data);
    emit('theme', message.data);
  } else if (message.event === 'locale') {
    applyLocale(message.data);
    emit('locale', message.data);
  }
});

export function call(method, args) {
  if (!host) return Promise.reject(new Error('请在桌面环境中打开本应用'));
  return new Promise((resolve, reject) => {
    const id = `r${++sequence}`;
    pending.set(id, { resolve, reject });
    host.postMessage({ __xyzos: 1, id, method, args }, hostOrigin);
  });
}

export async function backendJSON(path, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  let body = '';
  if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }
  const result = await call('backend', {
    path,
    method: options.method ?? 'GET',
    headers,
    body,
    bodyEncoding: 'text',
  });
  let parsed = null;
  if (result && result.body) {
    try {
      parsed = JSON.parse(result.body);
    } catch {
      parsed = null;
    }
  }
  if (!result || result.status >= 400) {
    throw new Error((parsed && parsed.error) || `请求失败（HTTP ${result?.status ?? 500}）`);
  }
  return parsed;
}

export function on(event, listener) {
  listeners.set(event, [...(listeners.get(event) ?? []), listener]);
  if (event === 'init' && context) listener(context);
}

export const permissions = () => (Array.isArray(context?.permissions) ? context.permissions : []);
export const locale = () => (typeof context?.locale === 'string' ? context.locale : 'zh-CN');

function applyTheme(theme) {
  if (!theme || typeof theme !== 'object') return;
  if (theme.theme === 'light' || theme.theme === 'dark') document.documentElement.dataset.theme = theme.theme;
  if (typeof theme.accent === 'string') document.documentElement.style.setProperty('--accent', theme.accent);
}

function applyLocale(value) {
  if (typeof value === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value)) {
    document.documentElement.lang = value;
  }
}

let lastActivity = 0;
for (const name of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
  document.addEventListener(
    name,
    (event) => {
      if (!context || !event.isTrusted || Date.now() - lastActivity < 1000) return;
      lastActivity = Date.now();
      call('activity').catch(() => {});
    },
    { capture: true, passive: true },
  );
}
