# 清单参考

`package/manifest.json` 是应用包与目标系统之间的核心契约文件（UTF-8 JSON），解析时**拒绝未知字段**。商店展示信息写在 `store.json`，不要写入清单。

> **格式判定**：格式 1 的全部字段在格式 2 中保留；只要使用了 `requires`、`access`、`surfaces`、`platform`、`backend`、`mcp`、`skills` 中的任一字段，`format` 必须为 `2`。

## 1. 基础字段（格式 1 & 格式 2）

| 字段 | 必需 | 规则 |
| --- | --- | --- |
| `format` | 是 | `1` 或 `2` |
| `slug` | 是 | `^[a-z0-9][a-z0-9-]{1,31}$`，不以 `-` 结尾，与目录名一致且发布后不可修改。禁用保留字（`api` `custom` `brand` `static` `assets` `apps` `sdk` `js` `css` `img` `healthz` `verify` `logout` `account` `settings`）与 `data-app-` 前缀 |
| `name` | 是 | 1–64 个字符，应用显示名 |
| `version` | 是 | SemVer，例如 `1.0.0`、`1.2.0-beta.1` |
| `description` | 否 | 最多 400 个字符 |
| `entry` | 条件 | 包根目录 `.html` 入口，与 `gateway_page` 二选一（格式 2 纯 MCP / 纯技能包可省略） |
| `gateway_page` | 条件 | `{ "proxy": "<key>", "path": "/portal/" }`，由受控代理加载上游网页 |
| `icon` | 是 | 包根目录 SVG / PNG / JPEG / WebP，≤ 64 KB |
| `window` | 否 | `{ "width", "height", "min_width"?, "min_height"? }`；宽 `320–3840`、高 `240–2160`，声明最小尺寸自动生成 `window.min_size` 标记 |
| `gateway_api` | 否 | 最多 8 个以 `/xyzos/api/` 开头的系统接口路径前缀 |
| `permissions` | 否 | 最多 16 项，**仅支持 `proxy.<key>`**，须与 `proxies` 对应（不与应用内权限 `access.permissions` 混用） |
| `proxies` | 否 | 最多 8 个受控代理声明，见第 2 节 |
| `desktop_widget` | 否 | `true` 表示提供桌面卡片（无界面应用不可声明） |
| `widget` | 否 | 声明式数据卡片配置（需 `desktop_widget: true`），见 [桌面卡片](05-widget.md) |

## 2. `proxies`：受控代理

应用不能直接访问外网，需经清单声明的受控代理由服务端转发并注入凭据：

```json
{
  "permissions": ["proxy.service"],
  "proxies": [
    {
      "key": "service",
      "title": "示例接口",
      "upstream": "https://api.example.com/v1",
      "base_url_editable": true,
      "auth_type": "bearer",
      "paths": ["/status", "/items"],
      "methods": ["GET"],
      "pass_query": true,
      "timeout_ms": 5000,
      "max_response_bytes": 262144
    }
  ]
}
```

| 字段 | 规则 |
| --- | --- |
| `key` / `title` | `key` 应用内唯一（规则同 `slug`）；`title` 1–64 字符 |
| `upstream` | `http` / `https` 地址，≤ 2048 字符，不含账号、查询串或片段 |
| `base_url_editable` | 设为 `true` 允许管理员安装时替换为自部署服务地址 |
| `auth_type` / `auth_header` | `none`、`bearer`、`basic`、`header`（选 `header` 时必填合法头名）；凭据由管理员安装时填写 |
| `paths` / `methods` | 1–12 个以 `/` 开头的路径前缀（≤ 256 字符，无 `..`）；方法为 `GET HEAD POST PUT DELETE` 子集，默认 `["GET"]` |
| `pass_query` | 是否转发查询串，默认 `false` |
| `timeout_ms` / `max_response_bytes` | 超时 `1000–30000`（默认 `5000`）；响应体 `1024–1048576`（默认 `262144`） |

生产转发时服务端重新解析 DNS，拒绝回环、链路本地、多播与保留地址，且不跟随重定向。

## 3. 格式 2 扩展字段

格式 2 应用至少包含界面、`mcp` 或 `skills` 之一：

| 字段 | 作用 | 详细文档 |
| --- | --- | --- |
| `requires` | `{ "platform": 1 }`，声明所需平台接口大版本（省略默认 `1`） | [能力总览](../platform/01-capabilities.md) |
| `access` | 声明应用内子权限与默认授予策略 | 见第 4 节 |
| `surfaces` | 窗口分级页面、独立标签页与公开页面入口 | [入口与公开页](../platform/06-surfaces-and-public.md) |
| `platform` | `uses`（平台能力白名单）与 `provides`（声明式扩展点） | [能力总览](../platform/01-capabilities.md)、[扩展点规范](../platform/04-extensions.md) |
| `backend` | Wasm ABI 1 后端模块、路由审计、三类存储、外联、回调、定时任务与令牌权限点 | [后端开发](07-backend.md) |
| `mcp` | AI 工具、只读资源、提示模板与远程 MCP | [MCP 与技能](../platform/05-mcp-and-skills.md) |
| `skills` | 纯文本技能列表（≤ 20 项） | [MCP 与技能](../platform/05-mcp-and-skills.md) |

## 4. `access`：应用内权限与默认授予

```json
{
  "access": {
    "permissions": [
      { "name": "item.write", "title": "编辑数据", "default": true },
      { "name": "config.manage", "title": "管理配置" }
    ],
    "default_grant": "none"
  }
}
```

- `permissions`：最多 32 项，`name` 匹配 `^[a-z][a-z0-9_.-]{1,47}$`（系统内登记为 `<slug>:<name>`），`title` 1–32 字符；
- `default_grant`：`none`（默认）、`all_accounts`、`all_accounts_and_new`；安装确认时管理员可改为 `none`。

## 5. 自动推导的能力标记

商店与 `appcheck` 自动根据清单生成版本 `capabilities`，用于客户端安装前兼容性校验：

| 标记 | 来源 |
| --- | --- |
| `gateway_page` / `gateway_api` | 上游页面 / 系统接口声明 |
| `desktop_widget` / `widget` / `widget.account_selector` | 桌面卡片 / 数据卡片 / 卡片账号切换器 |
| `window` / `window.min_size` | 窗口尺寸 / 最小尺寸 |
| `format.2` / `platform.<n>` | 格式 2 / `requires.platform` |
| `backend.wasm.abi<n>` / `backend.token_scopes` | Wasm 后端 ABI / 个人令牌接口权限点 |
| `storage.shared` / `storage.public` / `storage.account` | 后端启用的存储范围 |
| `access.permissions` / `access.default_grant` | 应用内权限 / 默认授予 |
| `surface.standalone` / `surface.public` / `surface.public.session` | 独立页 / 公开页 / 公开页可选登录态 |
| `uses.<能力>` / `provides.<扩展点>` | `platform` 声明 |
| `mcp.tools` / `mcp.declarative` / `mcp.remote` / `mcp.resources` / `mcp.prompts` / `skills` | MCP 与技能组件 |
