# 平台接口 v1（草案）

格式 2 应用的界面页面与目标系统交互的合同：消息协议、平台能力、声明式扩展点与托管组件库。清单字段（`platform.uses`、`platform.provides`）见[应用包格式 2](01-package-v2.md#6-platform平台能力与扩展点)；目标系统只实现其中一部分时，商店按能力标记显示“当前系统不支持”。示例应用见 [`apps/markdown-reader`](../../apps/markdown-reader/)。

需要后端的能力与扩展点（`tasks`、`realtime`、`lifecycle`、`search` 等）由[后端模块](02-backend.md)的宿主函数提供，不在本文范围。

## 1. 消息协议

页面运行在不透明源沙箱中，经 `window.parent.postMessage` 与桌面壳通信。目标源取页面基址的源：`new URL(document.baseURI).origin`；收到消息时同样校验 `event.source === window.parent` 与 `event.origin`。

| 方向 | 消息 |
| --- | --- |
| 页面 → 壳 | `{ __xyzos: 1, id, method, args }`；`id` 为页面内唯一的字符串（≤ 128 个字符）或安全整数 |
| 壳 → 页面（回复） | `{ __xyzos: 1, id, result }` 或 `{ __xyzos: 1, id, error }`（`error` 为可显示的文字） |
| 壳 → 页面（事件） | `{ __xyzos: 1, event, data }` |

同一窗口最多 8 个请求同时进行，重复的 `id` 被忽略。页面卸载、会话变化或锁屏时，未完成的请求不再回复。

### 事件

| 事件 | `data` |
| --- | --- |
| `init` | 每次页面加载完成时发送：`{ windowId, appId, params, theme, workspaceState, permissions, locale }`。`theme` 为 `{ mode, theme, accent, wallpaper }`（`theme` 是 `light` / `dark`），`permissions` 是当前账号拥有的应用内权限名，`locale` 为 BCP 47 语言标签 |
| `theme` | 主题变化，结构同 `init.theme`；页面应写入 `<html data-theme>` 与 `--accent` |
| `locale` | 界面语言变化 |
| `app:params:{appId}` | 窗口已打开时再次以启动参数打开本应用，`data` 为新的 `params` |

`permissions` 只供界面显示判断；目标系统对页面、接口与能力按同一授权独立检查。

### 方法

| `method` | `args` | 说明 |
| --- | --- | --- |
| `platform` | `{ capability, action, payload }` | 调用平台能力，见第 2 节；`capability` 须在 `platform.uses` 中声明（扩展点自带的能力按 `platform.provides`） |
| `backend` | `{ path, method?, headers?, body?, bodyEncoding? }` | 调用本应用在 `backend.routes` 声明的后端路由；`path` 须以 `/` 开头（可带查询串），`method` 为 `GET HEAD POST PUT PATCH DELETE`（默认 `GET`），`bodyEncoding` 为 `utf8`（默认）或 `base64`（上限 1 MB）。返回 `{ ok, status, headers, body, encoding }`（`encoding` 为 `text` 或 `base64`） |
| `backendUpload` | `{ path, file, filename?, scope?, headers? }` | 经目标系统直传大文件到指定 `POST` 后端路由（`file` 为 `File` 或 `Blob`，上限 50 MB 且受应用文件配额约束；`scope` 为 `shared` / `public` / `account`）；目标系统落盘后将临时路径与摘要交给模块，返回结构同 `backend` |
| `activity` | — | 用户正在操作页面，用于闲置锁屏计时；每秒最多一次 |
| `closeWindow` | — | 关闭当前窗口 |

## 2. 平台能力

| 能力 / 动作 | `payload` | `result` |
| --- | --- | --- |
| `identity` / `me` | — | `{ id, displayName, avatarUrl? }`；不含用户名、邮箱、手机号 |
| `notify` / `send` | `{ title, body? }` | 以应用名义给**调用者本人**发站内通知；标题 1–100 个字符、正文 ≤ 500 个字符；目标系统可限制频率 |
| `directory.pick` / `pick` | `{ multiple? }` | 系统选人窗口，返回选中成员 `[{ id, displayName }]`，取消为 `null`；只能选到能使用本应用的成员 |
| `files.pick` / `pick` | — | 系统文件选择窗口，返回 `{ fileId, name, mediaType, size, url, expiresAt }`，取消为 `null` |
| `files.reference` / `add`、`remove`、`list` | `add`/`remove`: `{ fileId, refKey? }` | 登记、解除或查询应用对已选管理文件的引用；被引用文件禁止回收或删除，应用卸载时自动释放 |
| `files.save` / `save` | `{ name, file? \| dataBase64?, refKey? }` | 把新文件保存到**调用者本人**的文件管理根目录（需调用者有文件管理权限，≤ 20 MB；规则同文件管理上传：PNG / JPEG 校验并重新编码、配额、默认存储位置），同名时自动改为 `名称 (2).ext`；SDK 接受 `Blob` / `File` 并自动转成 Base64。返回 `{ fileId, name, mediaType, size, width?, height?, refKey? }`；`refKey` 非空且声明了 `files.reference` 时同时登记引用 |
| `image.sanitize` / `sanitize` | `{ fileId?, dataBase64?, format?, quality?, destPath? }` | 仅接受 PNG / JPEG 并重新编码清洗；传 `destPath` 时写入应用 `/data/...` 存储并返回 `{ path, mediaType, width, height, size, sha256 }`，否则返回 `dataBase64` |
| `ai.complete` / `complete` | `{ system?, messages: [{ role, content }], maxOutput?, responseFormat? }` | 用目标系统的默认文本模型补全文本，返回 `{ text, model, usage: { inputTokens, outputTokens } }`；`role` 只能是 `user` / `assistant` 且最后一条为 `user`，最多 40 条、合计 ≤ 100000 字，`system` ≤ 8000 字，`responseFormat` 为 `text` / `json`；应用拿不到模型地址与密钥，按应用每日计量，超出管理员设定的上限返回 429，上限为 0 时返回 403 |
| `ai.image` / `generate` | `{ prompt, size?, quality?, destPath? }` | 生成一张 PNG：`prompt` ≤ 4000 字，`size` 为 `auto` 或 `宽x高` 比例（1:3–3:1），`quality` 为 `auto` / `low` / `medium` / `high`；传 `destPath` 时写入应用 `/data/...` 存储并返回 `{ path, mediaType, width, height, size }`，否则返回 `dataBase64`；需目标系统已开启生图，计量与限额同上 |
| `ui` / `toast` | `{ title, message?, type? }` | 系统通知条，`type` 为 `info` / `success` / `error` |
| `ui` / `alert`、`confirm` | `{ title, message?, okText?, cancelText?, danger? }` | 系统对话框；`confirm` 返回布尔值 |
| `ui` / `openApp` | `{ id, params? }` | 打开用户能使用的其他应用；`params.openWith` 会被去掉 |
| `ui` / `openPublicSite` | `{ path? }` | 在新标签页打开本应用的公开页（需声明 `surfaces.public` 且管理员已开启公开入口）；`path` 是公开页内的相对路径，不能含协议、主机或 `..` |
| `ui` / `resolveLink`、`openLink` | `{ uri }` | 解析或打开 `xyzos://app/{slug}/{path}` 跨应用深链（在桌面打开窗口，在独立页跳转对应独立地址） |
| `workspace.state` / `get`、`save` | `save` 传可 JSON 序列化的状态 | 窗口刷新后恢复的状态，按账号与窗口保存，目标系统可限制大小 |
| `settings` / `get` | — | 应用设置的当前值（见 3.1），只需声明扩展点 `settings` |

文件读取地址（`files.pick` 与 `open_with`）：页面直接 `fetch(url)` 读取，不带 Cookie、允许跨源；地址绑定当前会话、应用与文件，**一次性**，在 `expiresAt`（毫秒时间戳）前有效，读取时重新检查授权。应用不能列出用户的文件或成员。

## 3. 声明式扩展点

扩展点参数须是对象，≤ 8 KB，安装时校验，不合法时拒绝安装。

### 3.1 settings：应用设置

```json
{ "settings": { "fields": [
  { "key": "default_view", "type": "select", "title": "默认视图", "options": ["list", { "value": "board", "title": "看板" }], "default": "list" },
  { "key": "page_size", "type": "number", "title": "每页条数", "min": 5, "max": 100, "integer": true, "default": 20 },
  { "key": "welcome", "type": "text", "title": "欢迎语", "required": true, "maxLength": 100 },
  { "key": "show_archived", "type": "boolean", "title": "显示已归档" }
] } }
```

| 字段 | 规则 |
| --- | --- |
| `fields` | ≤ 32 个；为空时系统不显示设置入口 |
| `key` | `^[a-z][a-z0-9_]{0,31}$`，唯一 |
| `type` | `text`（单行，`maxLength` 默认 200、最大 2000）、`textarea`（多行，默认与最大 4000）、`number`（`min`、`max`、`integer`）、`boolean`、`select`（`options` 1–50 项，字符串或 `{ value, title }`，值 1–64 个字符且唯一） |
| `title` / `description` | 标题 ≤ 32 个字符（缺省为 `key`），说明 ≤ 200 个字符，不含控制字符 |
| `required` | 只用于文本字段 |
| `default` | 须满足字段规则；缺省时文本为空、数字为 0（按 `min` / `max` 收拢）、开关为 `false`、选择为第一项 |

管理员在系统的应用管理中按字段填写，系统校验并保存一份全应用共用的值。页面用 `settings` / `get` 读取，未保存的字段为默认值；应用更新后清单删掉的键丢弃，不再合法的值回到默认值。能使用该应用的成员都能读到设置，**不能用来保存密码或密钥**。

### 3.2 open_with：用…打开

```json
{ "open_with": { "types": ["text/markdown", ".md", "image/*"], "path": "/editor/" } }
```

| 字段 | 规则 |
| --- | --- |
| `types` | 1–20 项：MIME 类型、`type/*` 或扩展名（`.md`）；不区分大小写，不允许 `*/*` |
| `path` | 可选，从文件管理打开时加载的窗口页面（须是包内 HTML 页面，目录形式找 `index.html`）；缺省为 `surfaces.home` |

需要应用有窗口界面（`entry`）。用户在系统文件管理中对单个文件选择“用…打开”后，系统检查文件可读、类型匹配，签发与 `files.pick` 相同的一次性读取地址，并以启动参数 `params.openWith = { name, mediaType, size, url, expiresAt }` 打开应用窗口；窗口已打开时发送 `app:params:{appId}` 事件。启动参数不随窗口状态保存，刷新后不会重放。匹配按媒体类型（忽略参数）与扩展名。

### 3.3 builtin_import：导入内置功能配置

```json
{ "builtin_import": { "sources": ["articles.site"], "route": "/import/builtin" } }
```

| 字段 | 规则 |
| --- | --- |
| `sources` | 1 项起，目前只有 `articles.site`（目标系统内置文章站点的站点设置、站点图片与一言记录） |
| `route` | 必填，须在 `backend.routes` 中以非 `public` 的 `POST` 声明 |

需要后端模块。管理员在目标系统的应用管理中点击“导入内置配置”后，目标系统以 `POST` 调用 `route`，请求上下文 `entry` 为 `import`、调用者为该管理员，请求体为：

```json
{ "source": "articles.site", "exported_at": 1700000000000,
  "data": { "configured": true, "config": { "name": "...", "logoImage": 12, "...": "..." }, "revision": 3, "updated_at": 1700000000000,
    "files": [{ "file_id": "file:12", "name": "logo.png", "media_type": "image/png", "size": 2048, "width": 64, "height": 64 }],
    "quotes": [{ "day": "2026-11-26", "text": "...", "status": "ready", "source": "api", "fetched_at": 0, "updated_at": 0 }],
    "missing_files": ["file:99"] } }
```

`config` 保持目标系统内置站点设置的原始结构，其中的图片字段是文件编号数字（对应 `files` 中的 `file:<id>`）；`missing_files` 是配置引用、但已不在文件管理中的图片。目标系统会以文件所有者的名义为本应用登记这些图片的引用（需要 `platform.uses` 含 `files.reference`），应用随后可用 `files.reference.read` 或 `send_file: "file:<id>"` 读取；路由返回 `status >= 400` 时撤回本次新登记的引用。可重复导入，应用应按覆盖写入处理；请求体不超过 1 MB。

## 4. 托管组件库与主题

目标系统可以托管与自身同一版本的 `@xyzos/desk-ui` 与 React，应用不必打包进安装包：

- 页面在 `<head>` 中写 `<meta name="xyzos-desk-ui" content="1">`，目标系统返回该页面时注入导入映射与样式表；页面以 `<script type="module">` 直接 `import` `react`、`react-dom`、`react-dom/client`、`react/jsx-runtime` 与 `@xyzos/desk-ui`，所有入口共用一个 React 实例。只对格式 2 应用生效。
- 有构建步骤的应用把上述模块标为外部依赖（如 Vite `build.rollupOptions.external`）。
- 组件库的浅色 / 深色令牌按 `<html data-theme>` 生效，强调色读取 `--accent`；页面按 `init` 与 `theme` 事件写入。语言按 `init.locale` 与 `locale` 事件传给 `ConfigProvider`。
- 目标系统只托管组件库与 React，其他依赖由应用自行打包。
