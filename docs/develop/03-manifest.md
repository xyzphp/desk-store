# 清单参考

`package/manifest.json` 是 UTF-8 JSON，解析时**拒绝未知字段**：旧版本系统遇到不认识的字段会拒绝安装，所以商店展示信息写在 `store.json`，不要写进清单。

## 顶层字段

| 字段 | 必需 | 规则 |
| --- | --- | --- |
| `format` | 是 | 当前只能是 `1` |
| `slug` | 是 | `^[a-z0-9][a-z0-9-]{1,31}$`，不以连字符结尾，与目录名一致，发布后不可修改。不能使用保留字（`api` `custom` `brand` `static` `assets` `apps` `sdk` `js` `css` `img` `healthz` `verify` `logout` `account` `settings`）或 `data-app-` 前缀；目标系统还会保留自己的内建应用标识，安装时会再检查 |
| `name` | 是 | 1–64 个字符，桌面显示名 |
| `version` | 是 | semver，例如 `1.2.0`、`1.3.0-beta.1` |
| `description` | 否 | 最多 400 个字符 |
| `entry` | 二选一 | 包根目录的 `.html` 文件 |
| `gateway_page` | 二选一 | `{ "proxy": "<key>", "path": "/portal/" }`，由系统代理加载上游页面，见[沙箱与桥接](04-bridge.md#上游页面) |
| `icon` | 是 | 包根目录的 SVG / PNG / JPEG / WebP，≤ 64 KB |
| `window` | 否 | `{ "width": 900, "height": 620 }`，宽 320–3840，高 240–2160；可选 `min_width`（320 至 `width`）与 `min_height`（240 至 `height`）限制窗口最小尺寸，声明后生成能力标记 `window.min_size`，不支持的系统显示“当前系统不支持” |
| `gateway_api` | 否 | 最多 8 个系统接口路径前缀，必须以 `/xyzos/api/` 开头，见[沙箱与桥接](04-bridge.md#调用系统接口) |
| `permissions` | 否 | 最多 16 个，当前只支持 `proxy.<key>`，每个都必须有对应的代理 |
| `proxies` | 否 | 最多 8 个代理声明，见下文 |
| `desktop_widget` | 否 | `true` 表示提供桌面卡片 |
| `widget` | 否 | 声明式数据卡片，需要 `desktop_widget: true`，见[桌面卡片](05-widget.md) |

## proxies：受控代理

应用不能直接访问网络。需要外部数据时声明代理，系统在服务端转发请求，并注入管理员配置的凭据：

```json
{
  "key": "weather",
  "title": "天气接口",
  "upstream": "https://api.example.com/v1",
  "base_url_editable": true,
  "auth_type": "bearer",
  "paths": ["/now", "/forecast"],
  "methods": ["GET"],
  "pass_query": true,
  "timeout_ms": 5000,
  "max_response_bytes": 262144
}
```

| 字段 | 规则 |
| --- | --- |
| `key` | 应用内唯一，格式同 slug |
| `title` | 1–64 个字符，安装确认页显示 |
| `upstream` | `http` / `https` 地址，≤ 2048 字符，不能含账号、查询参数或片段；末尾 `/` 会被去掉 |
| `base_url_editable` | `true` 时管理员安装时可以改成实际的服务地址，适合自部署服务 |
| `auth_type` | `none`、`bearer`、`basic`、`header`；凭据不写在包里，由管理员安装时填写 |
| `auth_header` | `auth_type` 为 `header` 时必需，合法的 HTTP 头名 |
| `paths` | 1–12 个上游路径前缀，以 `/` 开头，≤ 256 字符，不能含查询、片段或目录跳转 |
| `methods` | `GET` `HEAD` `POST` `PUT` `DELETE` 的子集，默认 `["GET"]` |
| `pass_query` | 是否转发查询参数，默认否 |
| `timeout_ms` | 1000–30000，默认 5000 |
| `max_response_bytes` | 1024–1048576，默认 262144 |

每个代理都要在 `permissions` 中声明对应的 `proxy.<key>`。

请求路径为 `/` 时直接访问 `upstream` 本身；其他路径拼接在 `upstream` 后，例如 `https://api.example.com/v1` + `/now` = `https://api.example.com/v1/now`。

## 生产环境的地址限制

系统转发时会重新解析 DNS，拒绝回环、链路本地、多播和保留地址；不跟随重定向；按声明限制超时与响应大小。HTTP 上游只应该用于受信任的内网服务。
