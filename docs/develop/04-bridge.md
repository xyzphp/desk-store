# 沙箱与桥接

## 沙箱限制

应用页面运行在 `sandbox="allow-scripts"` 的 iframe 中，文档是不透明源：

- 没有登录会话 Cookie，不能发起同源请求；
- `localStorage`、`sessionStorage`、IndexedDB 不可用；
- 不能访问桌面页面的 DOM，也不能访问其他应用；
- 锁屏时窗口会被关闭。

需要与外部交互时，页面通过 `window.parent.postMessage` 把请求交给桌面壳，壳校验后代为请求。消息的目标源取页面基址的源：

```js
const origin = new URL(document.baseURI).origin;
```

每个请求带一个页面内唯一的 `id`（不超过 128 个字符的字符串，或安全整数），回复消息带同一个 `id`。同一窗口最多 8 个请求同时进行，单个请求 60 秒超时。

## 调用受控代理

```js
const pending = new Map();

window.addEventListener('message', (event) => {
  const data = event.data || {};
  if (event.source !== window.parent || data.type !== 'xyzos:proxy:response') return;
  const resolve = pending.get(data.id);
  if (resolve) {
    pending.delete(data.id);
    resolve(data);
  }
});

function proxy(name, path, options = {}) {
  return new Promise((resolve) => {
    const id = 'req-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    pending.set(id, resolve);
    window.parent.postMessage({
      type: 'xyzos:proxy',
      id,
      proxy: name,                 // 对应 proxies[].key
      path,                        // 必须在 paths 白名单内
      method: options.method || 'GET',
      query: options.query || '',  // 需要 pass_query: true
      body: options.body || '',
      contentType: options.contentType || '',
    }, new URL(document.baseURI).origin);
  });
}

const result = await proxy('weather', '/now', { query: 'city=shanghai' });
// result: { type, id, ok, status, contentType, body, error? }
```

`body` 是上游响应的文本。失败时 `ok` 为 `false`，`error` 给出原因；上游的 HTTP 错误通过 `status` 体现。请求体与路径都有大小限制，超出会直接返回错误。

## 调用系统接口

在清单中声明 `gateway_api` 前缀后，应用可以以**当前用户身份**调用这些前缀下的系统接口：

```json
{ "gateway_api": ["/xyzos/api/bookmarks/"] }
```

```js
window.parent.postMessage({
  type: 'xyzos:api',
  id: 'bookmarks-1',
  path: '/xyzos/api/bookmarks',
  method: 'GET',
}, new URL(document.baseURI).origin);
// 回复：{ type: 'xyzos:api:response', id, ok, status, contentType, body, encoding }
```

- 清单声明不会创建接口，只是允许访问；用户没有对应权限时只会得到 401 / 403。
- 会话、账户与凭据管理等敏感接口始终拒绝。
- 非文本响应以 base64 返回（`encoding` 为 `base64`），请求体上限 256 KB，响应上限 4 MB。
- 前缀会规整为尾斜杠形式；`/xyzos/api/bookmarks/` 允许访问 `/xyzos/api/bookmarks` 本身，但不匹配 `/xyzos/api/bookmarks-extra`。

**能调用系统接口的应用可以读取用户的数据**，评审时会重点检查这一项。只声明确实需要的前缀。

## 上游页面

已有网页服务时，可以不在包里放 HTML，而是让系统代理加载上游页面：

```json
{
  "gateway_page": { "proxy": "portal", "path": "/portal/" },
  "permissions": ["proxy.portal"],
  "proxies": [{
    "key": "portal", "title": "门户", "upstream": "https://portal.example.com",
    "base_url_editable": true, "auth_type": "none", "paths": ["/portal/"], "methods": ["GET"]
  }]
}
```

页面与它的资源都经同一代理加载，受路径白名单约束；页面中的同源绝对路径会被改写到代理地址，外部来源的资源不会加载。代理必须允许 `GET`，页面路径必须在白名单内。

## 主题

桌面卡片中的 iframe 会收到 `{ type: 'xyzos:widget:theme', theme, compact }` 消息，可以据此切换深浅色和紧凑布局。
