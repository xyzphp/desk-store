# 沙箱与桥接

应用页面运行在不透明源浏览器沙箱中，与外部服务、应用后端和平台能力通信均通过受控消息桥接完成；格式 2 应用还可直接复用系统托管的组件库。

## 1. 沙箱运行约束

页面运行在 `sandbox="allow-scripts"` 的 iframe 中：

- 拿不到登录会话 Cookie，不能直接发起同源或跨域网络请求；
- `localStorage`、`sessionStorage` 与 IndexedDB 不可用（状态持久化请使用 `workspace.state` 或后端存储）；
- 无法访问桌面壳 DOM 或其他应用窗口；锁屏时窗口自动销毁。

所有 `postMessage` 通信的目标源均取 `new URL(document.baseURI).origin`，接收回复时严格校验 `event.source === window.parent && event.origin === hostOrigin`。同一窗口最多允许 8 个并发请求，重复 `id` 会被忽略。

## 2. 格式 1 桥接协议

### 受控代理（`xyzos:proxy`）

```js
const hostOrigin = new URL(document.baseURI).origin;
const pending = new Map();

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.origin !== hostOrigin) return;
  const data = event.data || {};
  if (data.type !== 'xyzos:proxy:response') return;
  const resolve = pending.get(data.id);
  if (resolve) {
    pending.delete(data.id);
    resolve(data);
  }
});

function callProxy(name, path, options = {}) {
  return new Promise((resolve) => {
    const id = `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    pending.set(id, resolve);
    window.parent.postMessage(
      {
        type: 'xyzos:proxy',
        id,
        proxy: name,
        path,
        method: options.method || 'GET',
        query: options.query || '',
        body: options.body || '',
        contentType: options.contentType || '',
      },
      hostOrigin,
    );
  });
}
// 返回：{ type, id, ok, status, contentType, body, error? }
```

### 系统接口（`xyzos:api`）

声明 `gateway_api` 前缀后，可以当前用户身份访问白名单内的系统接口：

```js
window.parent.postMessage(
  { type: 'xyzos:api', id: 'api-1', path: '/xyzos/api/example', method: 'GET' },
  new URL(document.baseURI).origin,
);
// 回复：{ type: 'xyzos:api:response', id, ok, status, contentType, body, encoding }
```

用户无权访问时返回 `401` / `403`；会话、账号、角色、令牌与凭据类端点永久拒绝。请求体上限 256 KB，响应上限 4 MB（二进制以 `encoding: "base64"` 返回）。

### 上游页面（`gateway_page`）

声明 `gateway_page` 时，目标系统经对应只读代理加载上游网页并自动改写同源相对路径，外部来源资源不会被加载。

## 3. 格式 2 消息协议（`__xyzos: 1`）

| 方向 | 结构 | 说明 |
| --- | --- | --- |
| 页面 → 壳 | `{ __xyzos: 1, id, method, args }` | `id` 为 ≤ 128 字符字符串或安全整数 |
| 壳 → 页面（回复） | `{ __xyzos: 1, id, result }` 或 `{ __xyzos: 1, id, error }` | 失败时 `error` 为可读文本 |
| 壳 → 页面（事件） | `{ __xyzos: 1, event, data }` | 宿主下发的状态与生命周期事件 |

### 宿主事件

| 事件 | 说明 |
| --- | --- |
| `init` | 页面加载完成时触发：`{ windowId, appId, params, theme, workspaceState, permissions, locale }` |
| `theme` | 主题变化 `{ mode, theme, accent, wallpaper }`，页面写入 `<html data-theme>` 与 `--accent` |
| `locale` | 语言标签变化（BCP 47），传给组件库 `ConfigProvider` |
| `app:params:{appId}` | 窗口已打开时通过「用…打开」或深链再次触发时下发新 `params` |

### 桥接方法

- **`backend`**：调用 `backend.routes` 声明的 Wasm 后端接口，`args: { path, method?, headers?, body?, bodyEncoding? }`，返回 `{ ok, status, headers, body, encoding }`；
- **`backendUpload`**：直传 `File` / `Blob`（上限 50 MB）到后端 `POST` 路由，`args: { path, file, filename?, scope?, headers? }`；
- **`platform`**：调用已声明的平台能力 `{ capability, action, payload }`，完整清单见 [能力总览](../platform/01-capabilities.md)；
- **`activity` / `closeWindow`**：刷新闲置锁屏计时（每秒最多一次）/ 请求关闭当前窗口。

## 4. 托管组件库（`@xyzos/desk-ui`）

格式 2 页面可在 `<head>` 声明托管组件库元标签，由目标系统注入与宿主一致的 React 与 `@xyzos/desk-ui` 导入映射和样式表，无需打进安装包：

```html
<meta name="xyzos-desk-ui" content="1">
```

使用构建工具时，将以下 5 个模块设为外部依赖：

```ts
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', '@xyzos/desk-ui'],
    },
  },
});
```

页面根据 `init` 与 `theme` / `locale` 事件同步 `<html data-theme>`、`--accent` 与 `ConfigProvider`，即可与宿主深浅色与语言保持完全一致。
