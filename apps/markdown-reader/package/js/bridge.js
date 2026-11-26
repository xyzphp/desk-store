// 与 XYZOS 桌面壳通信的最小客户端（平台接口 v1 的消息协议）。
// 页面运行在不透明源沙箱中：请求经 window.parent.postMessage 交给壳，壳按清单 platform.uses 放行，
// 需要服务端的能力由网关再按会话、应用权限与清单逐次校验。
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
    emitOpenedFile(context.params);
  } else if (context && message.event === `app:params:${context.appId}`) {
    context.params = message.data;
    emitOpenedFile(message.data);
  } else if (message.event === 'theme') {
    applyTheme(message.data);
    emit('theme', message.data);
  } else if (message.event === 'locale') {
    applyLocale(message.data);
    emit('locale', message.data);
  }
});

/** 调用壳的方法；不在 XYZOS 中运行时直接失败。 */
export function call(method, args) {
  if (!host) return Promise.reject(new Error('请在 XYZOS 中打开本应用'));
  return new Promise((resolve, reject) => {
    const id = `r${++sequence}`;
    pending.set(id, { resolve, reject });
    host.postMessage({ __xyzos: 1, id, method, args }, hostOrigin);
  });
}

/** 平台接口 v1：capability 须在清单 platform.uses 中声明（settings 是扩展点，按 platform.provides 放行）。 */
export const platform = (capability, action, payload) => call('platform', { capability, action, payload });

export function on(event, listener) {
  listeners.set(event, [...(listeners.get(event) ?? []), listener]);
  // 页面脚本可能在 init 之后才注册监听：补发已收到的上下文与启动时传入的文件。
  if (event === 'init' && context) listener(context);
  if (event === 'openFile' && openedFile(context?.params)) listener(openedFile(context.params));
}

export const permissions = () => (Array.isArray(context?.permissions) ? context.permissions : []);
export const locale = () => (typeof context?.locale === 'string' ? context.locale : 'zh-CN');

function openedFile(params) {
  const file = params && typeof params === 'object' ? params.openWith : null;
  return file && typeof file === 'object' && typeof file.url === 'string' ? file : null;
}

function emitOpenedFile(params) {
  const file = openedFile(params);
  if (file) emit('openFile', file);
}

function applyTheme(theme) {
  if (!theme || typeof theme !== 'object') return;
  if (theme.theme === 'light' || theme.theme === 'dark') document.documentElement.dataset.theme = theme.theme;
  if (typeof theme.accent === 'string') document.documentElement.style.setProperty('--accent', theme.accent);
}

function applyLocale(value) {
  if (typeof value === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value)) document.documentElement.lang = value;
}

// 用户在页面中操作时告诉壳“仍在使用”，避免闲置锁屏计时把正在阅读的人锁出去（每秒最多一次）。
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
