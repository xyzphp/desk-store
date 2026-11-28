# 入口与公开页

通过 `manifest.json` 的 `surfaces` 字段，格式 2 应用可以统一声明桌面窗口内的页面分级权限、浏览器独立标签页以及对外开放的公开页面（支持服务端渲染 SSR 与标准订阅端点）。

## 1. `surfaces` 字段结构

```json
{
  "surfaces": {
    "home": "/",
    "window": {
      "pages": [
        { "path": "/", "visibility": "app" },
        { "path": "/settings/", "visibility": "permission:config.manage" }
      ]
    },
    "standalone": { "enabled": true },
    "public": {
      "pages": [
        { "path": "/", "visibility": "public" }
      ],
      "alias": "/example",
      "session": "optional"
    }
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `home` | 桌面窗口默认加载的起始路径，省略为 `/` |
| `window.pages` | 按**最长前缀匹配**控制窗口子路径权限；未列出的路径默认沿用 `app` |
| `standalone.enabled` | 设为 `true` 允许在浏览器新标签页通过 `{站点根}/apps/<slug>/...` 打开（仍校验登录态与应用权限） |
| `public.pages` | 公开页面路径前缀集合（`visibility: "public"` 仅允许出现在 `public` 入口） |
| `public.alias` | 建议绑定的简洁站点路径，不能占用系统保留路径，需管理员确认生效 |
| `public.session` | `"none"`（默认，纯匿名）或 `"optional"`（访客已登录时向后端提供脱敏身份，页面仍在沙箱内运行） |

> **安全默认策略**：声明 `surfaces.public` 的应用安装后**公开入口默认关闭**，需由管理员在应用管理中显式开启并核准别名。

## 2. 公开页 SSR 与订阅路由约定

当应用同时声明 `surfaces.public` 与 `backend` 时，目标系统对公开入口请求优先匹配以下 `visibility: "public"` 后端路由（未声明则回落包内静态资源）：

| 访客访问路径 | 优先匹配的后端路由 | 常见用途 |
| --- | --- | --- |
| `{公开根}/` | `GET /public/ssr` | 公开首页服务端渲染 HTML |
| `{公开根}/{subpath}` | `GET /public/ssr/{subpath}` | 详情页、归档或列表页 SSR |
| `{公开根}/rss.xml` | `GET /public/rss.xml` | RSS 订阅源 |
| `{公开根}/feed.xml` | `GET /public/feed.xml` | Feed 订阅源 |
| `{公开根}/sitemap.xml` | `GET /public/sitemap.xml` | 搜索引擎站点地图 |

当 SSR 路由返回 `text/html` 时，目标系统自动注入 `<base>`、只读公开上下文与安全响应头（禁止后端自行下发 `Set-Cookie`、`Content-Security-Policy` 或 `Access-Control-*`）。

## 3. 公开路由的强制隔离边界

1. **存储只读隔离**：`visibility: "public"` 路由与 `public` 入口**仅允许只读访问 `public` 存储**，不能读写 `shared` 或 `account` 存储。业务侧应在发布公开数据时显式写入 `public` 库，撤回时同步清理。
2. **禁止用户态宿主能力**：公开路由无法调用 `api_call`、`ai.complete`、`ai.image`、`files.save` 与 `image.sanitize`；若需输出作者已登记引用的文件，可通过 `files.reference.read` 或 `send_file: "file:<id>"` 在核实业务公开状态后输出。
3. **配置请求限频**：所有公开路由建议显式设置 `rate_limit`（如 `"120/min"` 或 `"60/min"`），保护后端并发资源：

```json
{
  "routes": [
    { "path": "/public/ssr", "methods": ["GET", "HEAD"], "visibility": "public", "rate_limit": "120/min" },
    { "path": "/public/ssr/*", "methods": ["GET", "HEAD"], "visibility": "public", "rate_limit": "120/min" },
    { "path": "/public/rss.xml", "methods": ["GET", "HEAD"], "visibility": "public", "rate_limit": "60/min" },
    { "path": "/public/sitemap.xml", "methods": ["GET", "HEAD"], "visibility": "public", "rate_limit": "60/min" }
  ]
}
```

## 4. 在窗口中安全跳转公开页

不要在前端硬编码 `/p/<slug>/` 或假设管理员已绑定别名，应通过平台能力 `ui / openPublicSite` 由宿主解析当前实际生效的地址：

```js
await invoke('platform', {
  capability: 'ui',
  action: 'openPublicSite',
  payload: { path: '/' },
});
```
