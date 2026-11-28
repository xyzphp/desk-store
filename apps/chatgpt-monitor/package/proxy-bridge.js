/* Codex Meter 页面适配：只通过 XYZOS 标准代理桥调用清单声明的接口。
 * 页面没有上游地址、Basic Auth 或桌面会话；服务端逐次验证授权与 CSRF。
 */
(function () {
  'use strict';

  const host = window.parent;
  const base = new URL('.', document.baseURI);
  // 首次页面 URL 可通过会话 Cookie 打开，而 <base> 已带资源能力。
  // 上游 apiURL 使用 location.href；两种包内目录都必须映射为同一 API。
  const pageBase = new URL('.', window.location ? window.location.href : document.baseURI);
  const allowedMethods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'DELETE']);
  const pending = new Map();
  let sequence = 0;

  const abortError = () => new DOMException('请求已取消', 'AbortError');
  const requestPath = (input) => {
    const raw = input instanceof Request ? input.url : String(input);
    // URL 会自动消除目录跳转，因此先检查原始输入，不允许它跨出包目录。
    if (/[\\\r\n\x00]/.test(raw) || /%(?:2e|2f|5c|25|00)/i.test(raw) ||
        raw.split(/[/?#]/).some((part) => part === '.' || part === '..')) {
      throw new TypeError('监控请求路径无效');
    }
    const url = new URL(raw, document.baseURI);
    const directory = [base, pageBase].find(candidate => candidate.origin === base.origin && url.origin === candidate.origin && url.pathname.startsWith(candidate.pathname));
    if (!directory || url.username || url.password || url.hash) {
      throw new TypeError('监控请求必须位于应用目录内');
    }
    const pathname = '/' + url.pathname.slice(directory.pathname.length);
    if (!(pathname.startsWith('/api/') || pathname === '/healthz' || pathname === '/openapi.yaml')) {
      throw new TypeError('监控请求不在代理白名单内');
    }
    return { path: pathname, query: url.search.slice(1) };
  };

  window.addEventListener('message', (event) => {
    if (event.source !== host || event.origin !== base.origin) return;
    const data = event.data;
    if (!data || data.type !== 'xyzos:proxy:response' || typeof data.id !== 'string') return;
    const settle = pending.get(data.id);
    if (settle) settle(data);
  });

  window.addEventListener('pagehide', () => {
    for (const settle of Array.from(pending.values())) settle({ error: '监控页面已关闭' });
  });

  window.fetch = async function (input, options = {}) {
    if (host === window) throw new Error('请在桌面环境中安装并打开此应用');
    const target = requestPath(input);
    const request = input instanceof Request ? input : null;
    const method = String(options.method || (request && request.method) || 'GET').toUpperCase();
    if (!allowedMethods.has(method)) throw new TypeError('监控请求方法不在代理白名单内');
    const headers = new Headers(options.headers || (request && request.headers) || {});
    const signal = options.signal || (request && request.signal);
    if (signal && signal.aborted) throw abortError();
    const body = options.body === undefined ? (request && method !== 'GET' && method !== 'HEAD' ? await request.clone().text() : '') : options.body;
    if (body && typeof body !== 'string') throw new TypeError('监控代理只接受文本请求体');
    if ((method === 'GET' || method === 'HEAD') && body) throw new TypeError('GET/HEAD 不允许请求体');
    if (new TextEncoder().encode(body || '').length > 256 * 1024) throw new TypeError('监控请求体超过 256 KB');

    return new Promise((resolve, reject) => {
      const id = 'chatgpt-monitor-' + (++sequence);
      let timer;
      const finish = (result) => {
        if (!pending.delete(id)) return;
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        const status = Number(result.status);
        if (!Number.isInteger(status) || status < 200 || status > 599) {
          reject(new Error(result.error || '监控代理返回无效响应'));
          return;
        }
        try {
          const noBody = method === 'HEAD' || status === 204 || status === 205 || status === 304;
          resolve(new Response(noBody ? null : (typeof result.body === 'string' ? result.body : ''), {
            status,
            headers: { 'Content-Type': result.contentType || 'text/plain; charset=utf-8' }
          }));
        } catch (error) { reject(error); }
      };
      const onAbort = () => {
        if (!pending.delete(id)) return;
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(abortError());
      };
      pending.set(id, finish);
      timer = setTimeout(() => finish({ error: '监控请求超时，请重试' }), 35000);
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) { onAbort(); return; }
      }
      try {
        // 不转发 Cookie、Authorization、App API Key 或任何任意请求头。
        host.postMessage({
          type: 'xyzos:proxy', id, proxy: 'monitor', ...target, method,
          body: body || '', contentType: headers.get('Content-Type') || (body ? 'application/json' : '')
        }, base.origin);
      } catch (error) { finish({ error: error.message || '监控代理调用失败' }); }
    });
  };
})();
