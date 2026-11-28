(function () {
  'use strict';
  const parent = window.parent;
  const origin = new URL(document.baseURI, window.location.href).origin;
  const pending = new Map();
  const paths = new Set(['/api/printer', '/api/camera/frame', '/healthz']);
  let sequence = 0;
  let closed = false;
  const abortError = () => new DOMException('请求已取消', 'AbortError');

  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== origin) return;
    const message = event.data;
    if (!message || message.type !== 'xyzos:proxy:response' || typeof message.id !== 'string') return;
    pending.get(message.id)?.(message);
  });

  function request(path, options = {}) {
    if (closed) return Promise.reject(abortError());
    if (parent === window) return Promise.reject(new Error('请在桌面中安装并打开此应用'));
    const method = String(options.method || 'GET').toUpperCase();
    if (method !== 'GET' || !paths.has(path)) return Promise.reject(new TypeError('应用只允许读取监控数据'));
    const body = options.body ?? '';
    if (body !== '') return Promise.reject(new TypeError('监控读取请求不接受请求体'));
    const signal = options.signal;
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const id = 'printer-request-' + (++sequence);
      let timer;
      function cleanup() { clearTimeout(timer); pending.delete(id); signal?.removeEventListener('abort', abort); }
      function abort() { cleanup(); reject(abortError()); }
      function finish(result) {
        if (!pending.has(id)) return;
        cleanup();
        const status = Number(result.status);
        if (!Number.isInteger(status) || status < 200 || status > 599) { reject(new Error(result.error || '代理服务未返回有效响应')); return; }
        const responseBody = result.body ?? '';
        if (typeof responseBody !== 'string' || new TextEncoder().encode(responseBody).length > 1048576) { reject(new Error('代理响应无效或超过大小限制')); return; }
        try { resolve(new Response([204, 205, 304].includes(status) ? null : responseBody, { status, headers: { 'Content-Type': result.contentType || 'application/json' } })); }
        catch (error) { reject(error); }
      }
      pending.set(id, finish);
      timer = setTimeout(() => { cleanup(); reject(new Error('监控服务请求超时')); }, 30000);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      try { parent.postMessage({ type: 'xyzos:proxy', id, proxy: 'monitor', path, method, body, contentType: body ? 'application/json' : '' }, origin); }
      catch (error) { cleanup(); reject(error); }
    });
  }

  function close() {
    closed = true;
    for (const settle of [...pending.values()]) settle({ error: '应用已关闭' });
  }
  window.PrinterBridge = { request, close };
  window.addEventListener('pagehide', close);
})();
