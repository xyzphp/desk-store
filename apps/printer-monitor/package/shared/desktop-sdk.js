/* 桌面子应用 SDK：在 iframe 页面中引入，与宿主系统通信 */
(function () {
  'use strict';
  const host = window.parent !== window ? window.parent : null;
  // 宿主页面 origin：沙箱应用是不透明源（location.origin 为 "null"），
  // 从注入的 <base href> 推导真实站点 origin 用于 postMessage 定向与校验。
  const hostOrigin = (() => {
    try { return new URL(document.baseURI, window.location.href).origin; }
    catch { return window.location.origin; }
  })();
  const pending = new Map();
  const handlers = {};
  let seq = 0, ctx = null;
  const readyFns = [];

  function call(method, args) {
    if (!host) return Promise.reject(new Error('未运行在桌面环境中'));
    return new Promise((resolve, reject) => {
      const id = 'c' + ++seq;
      pending.set(id, { resolve, reject });
      host.postMessage({ __xyzos: 1, id, method, args }, hostOrigin);
    });
  }

  window.addEventListener('message', (e) => {
    if (e.source !== host || e.origin !== hostOrigin) return;
    const m = e.data;
    if (!m || m.__xyzos !== 1) return;
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error)) : p.resolve(m.result);
      return;
    }
    if (m.event === 'init') { ctx = m.data; readyFns.splice(0).forEach((f) => f(ctx)); }
    (handlers[m.event] || []).forEach((f) => f(m.data));
  });

  window.XYZOSSDK = {
    inOS: !!host,
    ready(fn) { ctx ? fn(ctx) : readyFns.push(fn); },
    on(evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); },
    call,
    notify: (o) => call('notify', o),
    alert: (o) => call('alert', o),
    confirm: (o) => call('confirm', o),
    prompt: (o) => call('prompt', o),
    openApp: (id, params) => call('openApp', { id, params }),
    getTheme: () => call('getTheme'),
    setTheme: (mode) => call('setTheme', mode),
    setTitle: (t) => call('setTitle', t),
    getWorkspaceState: () => call('getWorkspaceState'),
    saveWorkspaceState: (state) => call('saveWorkspaceState', state),
    close: () => call('closeWindow'),
    emit: (event, data) => call('emit', { event, data })
  };

  // 自动同步主题到 <html data-theme>
  const applyTheme = (t) => { document.documentElement.dataset.theme = t.theme; document.documentElement.style.setProperty('--accent', t.accent); };
  window.XYZOSSDK.ready((c) => applyTheme(c.theme));
  window.XYZOSSDK.on('theme', applyTheme);

  let lastActivity = 0;
  for (const name of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) document.addEventListener(name, (event) => {
    if (!host || !ctx || !event.isTrusted || Date.now() - lastActivity < 1000) return;
    lastActivity = Date.now();
    call('activity').catch(() => {});
  }, { capture: true, passive: true });
})();
