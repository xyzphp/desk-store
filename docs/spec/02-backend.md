# 后端模块、存储与数据库迁移（草案）

本页规定格式 2 应用的后端模块：运行方式、接口约定、可用的宿主能力、三类存储，以及**数据库迁移在安装与更新时如何执行**。

## 1. 运行方式

- 后端是一个 WebAssembly 模块（`backend/app.wasm`，WASI preview 1），由目标系统在服务端加载。模块没有文件系统、网络套接字与环境变量，所有对外能力都经目标系统提供的宿主函数。
- 每个请求在新的实例中执行，执行完即销毁；请求之间不共享内存，持久状态只能写入第 4 节的存储。
- 资源限制默认值：单次执行 5 秒、内存 64 MB、每个应用并发 8、经模块的请求与响应体各 1 MB；清单可在上限（30 秒、256 MB）内调整。超限时目标系统终止执行并返回错误。

## 2. 清单 backend 字段

```json
{
  "backend": {
    "runtime": "wasm",
    "abi": 1,
    "module": "backend/app.wasm",
    "limits": { "timeout_ms": 5000, "memory_mb": 64 },
    "routes": [
      { "path": "/articles", "methods": ["GET", "POST"], "visibility": "permission:article.write" },
      { "path": "/public/*", "methods": ["GET"], "visibility": "public", "rate_limit": "60/min" }
    ],
    "storage": { "shared": true, "public": true, "account": false, "files_mb": 1024, "database_mb": 200 },
    "http": { "allow": [{ "host": "api.example.com", "methods": ["GET"] }] },
    "hooks": [{ "name": "payment" }],
    "schedules": [{ "name": "daily-digest", "cron": "0 9 * * *", "route": "/jobs/daily-digest" }],
    "config": [{ "key": "api_secret", "title": "接口密钥", "secret": true }]
  }
}
```

| 字段 | 规则 |
| --- | --- |
| `runtime` / `abi` | 当前只有 `wasm` / `1` |
| `routes` | ≤ 64 条；`path` 以 `/` 开头，可用末尾 `*` 表示前缀；`methods` 为 `GET HEAD POST PUT PATCH DELETE` 的子集；`visibility` 取值同[应用包格式 2](01-package-v2.md#5-surfaces界面入口与可见范围)；`public` 路由只能读写公开存储，不能调用以用户身份执行的能力 |
| `storage` | 使用哪些存储范围与配额，见第 4 节 |
| `http.allow` | ≤ 16 个主机（可带端口）与方法；目标系统发出请求时按自身地址策略校验解析后的地址 |
| `hooks` | ≤ 8 个公开回调，地址 `{站点根}/custom/<slug>/hooks/<name>`，无会话，签名由模块校验 |
| `schedules` | ≤ 8 个定时任务，标准五段 cron，最小间隔 5 分钟；以应用身份执行，没有调用者 |
| `config` | ≤ 16 个安装配置项；`secret` 项加密保存，只能被模块读取，任何接口都不回显 |
| `token_scopes` | ≤ 16 个个人令牌权限点 `{ id, label, description? }`（`id` 同 hooks 命名规则，`label` 1-16 字，`description` ≤ 120 字）；路由用 `token_scope: "<id>"` 引用（`public` 路由不能引用），每个权限点至少被一条路由引用。目标系统在个人令牌设置中按应用列出这些权限点（默认不勾选），令牌勾选后可直接以 `Authorization: Bearer` 调用引用该权限点的路由，仍按路由 `visibility` 校验账号权限；未声明 `token_scope` 的路由不接受令牌。能力标记 `backend.token_scopes` |

## 3. 接口约定（ABI 1）

### 3.1 模块形态与导出

- 后端以 WASI preview 1 **reactor** 形态构建（Go 使用 `GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared -trimpath`）。
- 必须导出：
  - `_initialize() -> ()`：实例化后的初始化入口，每次请求执行一次。
  - `memory`：线性内存。
  - `handle() -> i32`：统一请求处理入口；读取请求信封、写入响应信封后返回 `0` 表示正常完成，非零视为内部错误。
- 可选导出：
  - `migrate() -> i32`：数据库迁移完成后执行的 `lifecycle` 数据转换钩子（见第 5.1 节）。

### 3.2 请求与响应信封

- 请求信封通过 `host.request_len` / `host.request_read` 以 UTF-8 JSON 读取，结构如下：

```json
{
  "method": "POST",
  "path": "/tasks/42",
  "query": "status=open",
  "headers": { "content-type": "application/json", "accept": "application/json" },
  "body_b64": "eyJ0aXRsZSI6IkhlbGxvIn0=",
  "context": {
    "app_slug": "todo-collab",
    "entry": "window",
    "user": { "id": 12, "display_name": "Alice" },
    "permissions": ["task.write"],
    "locale": "zh-CN",
    "route": "/tasks/*",
    "visibility": "permission:task.write"
  }
}
```

- **调用上下文**由目标系统填写，模块不能修改：入口（`window` / `standalone` / `public` / `tool` / `token` / `import` / `schedule` / `hook` / `lifecycle`；`token` 为个人令牌按 `token_scopes` 调用，调用者为令牌所属账号，不能使用 `api_call`；`import` 为管理员触发的内置配置导入，见[平台接口 v1](04-platform-v1.md#33-builtin_import导入内置功能配置)）、调用者（账号编号、显示名称；匿名与系统调用时为 `null`）、调用者在本应用内拥有的权限、语言、命中的路由模板与可见级别。
- 请求头白名单（键统一小写）：`accept`、`accept-language`、`content-type`、`if-match`、`if-none-match`、`if-modified-since`、`x-request-id`（`hook` 入口另放行签名类请求头；会话 Cookie、认证与 CSRF 头绝不透传）。
- 响应信封通过 `host.response_write` 写入 UTF-8 JSON（编码后上限随响应体 1 MB 限制，重复调用以最后一次为准）：

```json
{
  "status": 200,
  "headers": { "content-type": "application/json; charset=utf-8" },
  "body_b64": "eyJvayI6dHJ1ZX0=",
  "send_file": ""
}
```

- 响应头白名单（键统一小写）：`content-type`、`cache-control`、`etag`、`last-modified`、`vary`、`content-disposition` 与 `x-app-*` 前缀自定义头；禁止设置 `set-cookie`、`content-security-policy`、`location`、`access-control-*` 等安全相关响应头。`send_file` 为可选的 `/data/...` 路径或已登记引用的用户文件 `file:<id>`，供目标系统直传下载（见第 3.7 节）。

### 3.3 宿主函数（模块名 `host`）

模块只允许从 `wasi_snapshot_preview1` 与 `host` 两个模块导入函数；导入未在清单声明的能力时安装校验拒绝。宿主函数采用“宿主结果缓冲区”约定，无需模块导出内存分配器：返回值 `>= 0` 表示成功且为待读结果载荷的字节数（0 表示空载荷）；返回值 `< 0` 表示失败（`-1` 通用错误、`-2` 未声明或无权限、`-3` 参数无效、`-4` 不存在、`-5` 超过限制或配额、`-6` 超时或已取消），错误说明存入同一缓冲区。调用方通过 `host.result_read(0, 0)` 查询当前缓冲区字节长度，再调用 `host.result_read(ptr, len)` 拷贝内容。

| 导入函数（`host.*`） | 签名 | 需要的清单声明 | 说明 |
| --- | --- | --- | --- |
| `request_len` | `() -> u32` | 无（核心） | 返回当前请求信封 JSON 的字节长度 |
| `request_read` | `(ptr u32, len u32) -> i32` | 无（核心） | 将请求信封复制到 guest 内存，返回写入字节数 |
| `response_write` | `(ptr u32, len u32) -> i32` | 无（核心） | 写入响应信封 JSON，成功返回 `0` |
| `result_read` | `(ptr u32, len u32) -> i32` | 无（核心） | `len == 0` 时返回当前结果/错误缓冲区长度，否则拷贝到 guest 内存 |
| `log` | `(level u32, ptr u32, len u32) -> i32` | 无 | 写入应用日志（`0` debug / `1` info / `2` warn / `3` error；单条 ≤ 4 KB，单次请求 ≤ 64 条） |
| `config_get` | `(key_ptr u32, key_len u32) -> i32` | `backend.config` | 按键读取安装配置值，不存在返回 `-4`，未声明返回 `-2` |
| `db_call` | `(ptr u32, len u32) -> i32` | `backend.storage` 任一范围 | 执行参数化 SQL 或事务（JSON 请求 / 响应） |
| `kv_call` | `(ptr u32, len u32) -> i32` | `backend.storage` 任一范围 | 按键读写 JSON 集合 |
| `http_fetch` | `(ptr u32, len u32) -> i32` | `backend.http.allow` | 经目标系统发出外部 HTTP 请求 |
| `proxy_fetch` | `(ptr u32, len u32) -> i32` | 格式 1 的 `proxies` | 经已声明代理访问，凭据由目标系统注入 |
| `api_call` | `(ptr u32, len u32) -> i32` | 格式 1 的 `gateway_api` | 以调用者身份调用目标系统接口；无调用者时不可用 |
| `platform_call` | `(ptr u32, len u32) -> i32` | `platform.uses` 或 `provides.settings` | 调用平台能力（如 `settings.get`、`notify`、`image.sanitize`） |

除上述函数外，`/data` 文件读写经标准 WASI preview 1 文件接口提供（`/data/shared`、`/data/public`、`/data/me`），目标系统禁用符号链接与硬链接并在写入时强制配额。

### 3.4 `db_call` 与 `kv_call` 载荷协议

- **`host.db_call(ptr, len) -> i32`**（请求体 ≤ 1 MB，UTF-8 JSON）：

```json
{
  "scope": "shared",
  "op": "query",
  "tx": "",
  "sql": "SELECT id, title FROM tasks WHERE status = ?",
  "args": ["open"]
}
```

  - `scope` 为 `shared`、`public` 或 `account`，须在 `backend.storage` 中声明；`public` 路由与 `public` 入口仅允许访问 `public` 且为只读；`account` 仅允许已认证调用者访问本人独立库。
  - `op` 支持：
    - `query`：执行参数化单条查询（或写连接上的 `... RETURNING`），返回 `{ "columns": [...], "rows": [[...]] }`（响应 JSON ≤ 1 MB，超出返回 `-5`）。二进制参数与结果以 `{ "$blob_b64": "<base64>" }` 表示。
    - `exec`：执行参数化单条写语句（`INSERT` / `UPDATE` / `DELETE` / `REPLACE` / `WITH`），返回 `{ "rows_affected": 1, "last_insert_id": 42 }`。
    - `begin`：在指定 `scope` 上开启本次请求内的事务，返回 `{ "tx": "<id>" }`；单次请求最多同时开启 4 个事务，请求结束时未提交的事务自动回滚。
    - `commit` / `rollback`：提交或回滚 `tx`，返回 `{}`。
  - 语句限制：每次只允许严格单条语句；运行时禁止 `ATTACH`、`DETACH`、`VACUUM`、`PRAGMA`、DDL、原始事务控制语句及访问保留表 `_app_migrations` / `_app_kv`、`pragma_*`、`load_extension` 与内部虚拟表；表结构变更只通过第 5 节的迁移文件完成。

- **`host.kv_call(ptr, len) -> i32`**（请求体 ≤ 512 KB，UTF-8 JSON）：

```json
{ "scope": "shared", "op": "get", "key": "board.order", "value": null, "prefix": "", "limit": 100 }
```

  - `scope` 权限与只读规则同 `db_call`。`key` 为 1–128 字节有效 UTF-8（无控制字符），`value` 为任意 JSON 值（序列化后 ≤ 256 KB）。
  - `op` 支持 `get`（返回 `{ "found": bool, "value"?, "updated_at"? }`）、`set`（返回 `{ "ok": true, "updated_at": ms }`）、`delete`（返回 `{ "deleted": bool }`）、`list`（按 `prefix` 前缀列出最多 `limit` 条，默认 100、上限 500，返回 `{ "items": [{ "key", "value", "updated_at" }], "has_more": bool }`）。

### 3.5 `http_fetch`、`proxy_fetch`、`api_call` 与 `platform_call` 载荷协议

所有调用的请求 JSON 与响应载荷均受 1 MB 上限约束（超出返回 `-5`）。

- **`host.http_fetch(ptr, len) -> i32`**（需要 `backend.http.allow`）：

```json
{
  "method": "GET",
  "url": "https://api.example.com/v1/items?page=1",
  "headers": { "accept": "application/json" },
  "body_b64": "",
  "timeout_ms": 5000
}
```

  - `url` 仅允许 `http` / `https`，禁止携带账号信息；目标主机（小写域名及可选端口）与方法必须命中 `backend.http.allow`，且解析后的地址须通过目标系统的地址安全策略（非本地模式拒绝回环、链路本地、多播与保留地址）。
  - 重定向最多跟随 3 次，每一跳目标主机与方法都必须同样在 `backend.http.allow` 内并通过地址策略，跨主机跳转时清除敏感请求头；越界返回 `-2`。
  - 成功返回：`{ "status": 200, "headers": { "content-type": "application/json" }, "body_b64": "<base64>" }`。

- **`host.proxy_fetch(ptr, len) -> i32`**（需要清单声明 `proxies`）：

```json
{
  "proxy": "upstream",
  "method": "GET",
  "path": "/v1/status",
  "query": "full=1",
  "headers": { "accept": "application/json" },
  "body_b64": ""
}
```

  - `proxy` 须命中清单声明的代理键，方法、路径与 `query` 受代理白名单和 `pass_query` 约束；代理凭据由目标系统在服务端注入，不向模块暴露；不跟随重定向。
  - 成功返回：`{ "status": 200, "headers": { "content-type": "application/json" }, "body_b64": "<base64>" }`。

- **`host.api_call(ptr, len) -> i32`**（需要清单声明 `gateway_api`，且当前请求存在已认证浏览器调用者；`public` / `hook` / `schedule` / `lifecycle` 等无调用者入口一律返回 `-2`）：

```json
{
  "method": "GET",
  "path": "/xyzos/api/bookmarks",
  "query": "limit=20",
  "headers": { "accept": "application/json" },
  "body_b64": ""
}
```

  - `path` 须命中 `gateway_api` 前缀白名单，且禁止访问会话、令牌、账号、角色、实时通道、安全设置、自定义应用管理、模型与通知设置等受限系统端点；实际请求严格以当前调用者的会话身份执行，不会提权。
  - 成功返回：`{ "status": 200, "headers": { "content-type": "application/json" }, "body_b64": "<base64>" }`。

- **`host.platform_call(ptr, len) -> i32`**（需要 `platform.uses` 或 `platform.provides.settings`）：

```json
{ "action": "settings.get", "params": {} }
```

  - 支持的 `action`：
    - `settings.get`（需要 `platform.provides.settings`）：返回 `{ "values": { ... }, "updated_at": 1700000000000 }`。
    - `identity.me`（需要 `platform.uses` 含 `identity` 且存在调用者）：返回 `{ "id": 12, "display_name": "Alice", "avatar_url": "..." }`。
    - `notify.send`（需要 `platform.uses` 含 `notify`）：`params` 为 `{ "title": "...", "body": "...", "user_id": 12 }`；存在调用者时 `user_id` 可省（默认为调用者本人），无调用者时必填；目标账号必须处于正常状态且已获授该应用，返回 `{ "ok": true }`。
    - `files.reference.add` / `files.reference.remove` / `files.reference.list`（需要 `platform.uses` 含 `files.reference` 且存在登录调用者）：按 `file_id`（`file:<id>`）与可选 `ref_key` 登记、解除或查询应用对用户管理文件的引用，防止文件在文件管理中被误删；应用卸载时由宿主自动释放。
    - `files.reference.read`（需要 `platform.uses` 含 `files.reference`，任意入口可用，包括 `public`、`schedule`、`hook`）：`params` 为 `{ "file_id": "file:<id>", "meta_only"?: true }`；只要有任一账号为本应用登记了该文件的引用即可读取，返回 `{ "file_id", "name", "media_type", "size", "width", "height", "updated_at", "data_b64" }`（`meta_only` 时不含 `data_b64`）；内容超过 4 MB 返回限额错误，应改用 `send_file`。谁能看到文件由应用按自己的数据判断（如文章是否公开发布）；作者解除全部引用后应用即不能再读取。
    - `ai.complete`（需要 `platform.uses` 含 `ai.complete`，`public` 与 `hook` 入口禁止）：`params` 为 `{ "system"?: "...", "messages": [{ "role": "user", "content": "..." }], "max_output"?: 800, "response_format"?: "text"|"json" }`，规则同[平台接口 v1](04-platform-v1.md#2-平台能力) 的 `ai.complete`，返回 `{ "text", "model", "usage": { "input_tokens", "output_tokens" } }`；调用阻塞当前执行并受 `limits.timeout_ms` 约束，耗时较长的生成应放在页面调用。`ai.image` 只能经页面调用，后端调用返回 `-2`。
    - `image.sanitize`（需要 `platform.uses` 含 `image.sanitize`，`public` 入口禁止）：`params` 为 `{ "source_path"?: "/data/...", "data_b64"?: "...", "dest_path": "/data/...", "format"?: "png"|"jpeg", "quality"?: 85 }`；严格校验 PNG / JPEG 并重新编码剥离元数据与尾部字节，写入受配额约束的 `dest_path`，返回 `{ "path", "media_type", "width", "height", "size", "sha256" }`。

- **公开页面 SSR 路由约定**：当应用同时声明 `surfaces.public` 与 `backend` 时，目标系统对公开访问的页面请求优先匹配以下 `visibility: "public"` 的后端路由（未声明时回落至包内静态页面）：
  - 公开根路径 `/` → `GET /public/ssr`；子路径 `/{rest}` → `GET /public/ssr/{rest}`（返回 `text/html` 时由目标系统自动注入 `<base>`、只读公开上下文与安全响应头）。
  - `/sitemap.xml` → `GET /public/sitemap.xml`；`/rss.xml` → `GET /public/rss.xml`；`/feed.xml` → `GET /public/feed.xml`。

### 3.6 公开回调（`hooks`）、定时任务（`schedules`）与迁移钩子（`migrate`）

- **公开回调**：外部服务请求 `{站点根}/custom/<slug>/hooks/<name>`（无需会话，受每应用/IP 限频与 1 MB 请求体上限约束）。请求信封的 `path` 为 `/hooks/<name>`、`context.entry` 为 `"hook"`、`context.user` 为 `null`、`context.route` 为 `/hooks/<name>`；除标准请求头白名单外，额外放行常见签名与回调头（`user-agent`、`x-timestamp`、`stripe-signature`、`svix-*`、`x-signature*`、`x-hub-signature*`、`x-webhook-*`、`x-github-*`、`x-gitlab-*`）。模块应通过 `config_get` 读取密钥自行验签；可读写 `shared` / `public` 存储，不可访问 `account` 存储与 `api_call`。
- **定时任务**：目标系统按标准五段 cron（最小间隔 5 分钟）触发对应 `POST` 路由。请求信封的 `method` 为 `"POST"`、`path` 为 `schedule.route`、`body_b64` 为 `{"schedule":"<name>","triggered_at":<unix_ms>}` 的 Base64、`context.entry` 为 `"schedule"`、`context.user` 为 `null`。可读写 `shared` / `public` 存储与调用外联/平台能力，不可访问 `account` 存储与 `api_call`。
- **迁移钩子（`migrate`）**：更新或安装执行完 SQL 迁移后，如模块导出了 `migrate() -> i32`，目标系统以 `method: "POST"`、`path: "/lifecycle/migrate"`、`body_b64: base64({"from_version":"...","to_version":"..."})`、`context.entry: "lifecycle"`、`context.user: null` 调用一次。返回 `0` 表示成功（无需调用 `response_write`），非零则中止安装或更新并回滚恢复备份。

### 3.7 文件直传（上传与 `send_file` 下载）

- **大文件上传**：目标系统将前端直传的文件校验大小与配额后直接写入对应范围的临时目录 `/data/<scope>/.uploads/<id>`，再以 `POST` 调用目标路由，请求体为 UTF-8 JSON：

```json
{
  "upload": {
    "path": "/data/shared/.uploads/<id>",
    "scope": "shared",
    "filename": "report.pdf",
    "media_type": "application/pdf",
    "size": 123456,
    "sha256": "<hex>"
  }
}
```

  模块可经标准 `/data` 文件接口校验或重命名该文件到最终位置；若模块执行失败或返回 `status >= 400` 且临时文件仍在原处，目标系统自动删除并退回配额。
- **大文件下载（`send_file`）**：模块在响应信封中设置 `send_file` 为 `/data/shared/...`、`/data/public/...` 或 `/data/me/...`（不设 `body_b64`），目标系统校验范围、路径与符号链接后直接流式输出文件内容（不受 1 MB 响应体限制），自动附加 `X-Content-Type-Options: nosniff` 与安全 `Content-Disposition`。
- **发送用户文件（`send_file: "file:<id>"`）**：声明了 `platform.uses: ["files.reference"]` 的应用可把 `send_file` 设为已登记引用的用户文件编号，目标系统从文件管理的存储（本地或 S3）直接流式输出，`content-type` 未指定时使用文件记录的类型；文件未被本应用引用或已删除时返回 404。安全响应头与 `/data` 文件相同。

## 4. 存储

| 范围 | 数据库 | 文件目录 | 谁能访问 |
| --- | --- | --- | --- |
| `shared` | 共享库 | `/data/shared` | 应用的授权用户经后端访问，由后端按应用内权限判断 |
| `public` | 公开库 | `/data/public` | 后端读写；`public` 入口与 `public` 路由只读 |
| `account` | 每个账号一个库 | `/data/me` | 只有该账号本人；目标系统每次只为当前调用者打开他自己的库与目录 |

- 数据库是 SQLite 方言，与目标系统主库**完全隔离**（不同文件、不同连接），不能 ATTACH 其他数据库、不能加载扩展、不能写出库外文件（如 `VACUUM INTO`）。
- 单次结果 ≤ 1 MB，超出时应分页；单库默认上限 200 MB，文件目录默认 1 GB，可在清单中声明更小或申请更大（目标系统可以拒绝）。
- 大文件上传与下载不经过模块：目标系统把上传文件写入应用目录后通知模块，下载时由模块指定文件、目标系统直接发送。

## 5. 数据库迁移

表结构的任何变化都必须通过迁移文件完成，安装与每次更新时由目标系统执行。

### 5.1 文件规则

```text
package/backend/migrations/
  shared/0001_init.sql
  shared/0002_add_cover.sql
  public/0001_init.sql
  account/0001_init.sql
```

- 按存储范围分目录，只有在 `storage` 中启用的范围可以有迁移。
- 文件名 `NNNN_<名称>.sql`，四位编号从 `0001` 开始**连续递增**，名称为小写字母、数字与连字符。
- 一个文件可以包含多条语句；只允许 DDL 与数据语句（`CREATE`、`ALTER`、`DROP`、`INSERT`、`UPDATE`、`DELETE`、`CREATE INDEX` 等），不允许 `ATTACH`、`PRAGMA`（`foreign_keys` 除外）、`VACUUM` 与事务控制语句（由目标系统包事务）。
- **已发布的迁移不可修改、不可删除、不可重新编号**，只能追加新文件。商店 CI 与目标系统都会核对（第 5.3 节）。
- 不提供回退迁移；需要撤销时追加一个新的正向迁移。破坏性变更建议分两步：先加新列 / 新表并兼容旧数据，下一个版本再删除旧结构。
- 需要用代码转换数据时，在模块中导出 `migrate` 处理函数（`lifecycle` 入口，参数为旧版本与新版本），它在本次所有 SQL 迁移执行之后运行一次。

### 5.2 执行记录

每个数据库内有一张由目标系统维护的表 `_app_migrations`（模块不能读写）：

| 列 | 说明 |
| --- | --- |
| `id` | 迁移编号与名称，如 `0002_add_cover` |
| `sha256` | 文件内容摘要 |
| `app_version` | 执行时的应用版本 |
| `applied_at` | 执行时间 |

### 5.3 一致性核对

- 商店为每个版本发布迁移摘要（见[商店数据格式补充](03-catalog.md#3-迁移摘要)）。CI 把新版本的迁移与上一个已发布版本比较：已有文件的摘要必须一致，新文件必须接在最后编号之后，否则拒绝合并。
- 目标系统执行前核对：`_app_migrations` 中已执行的每一项，新包里必须有同名文件且摘要一致；不一致（已发布的迁移被修改）时拒绝更新并提示管理员。

### 5.4 安装与更新流程

1. 管理员确认安装或更新之前，**不执行任何迁移**，旧版本照常运行。
2. 确认后，目标系统暂停该应用的请求（排队或返回“正在更新”），对 `shared` 与 `public` 库做一致性备份。
3. 在每个库的事务中按编号执行尚未执行的迁移，逐条写入 `_app_migrations`。
4. 加载新模块；如导出了 `migrate`，以 `lifecycle` 入口执行一次。
5. 全部成功：切换到新版本，恢复请求，删除备份。
6. 任一步失败：回滚事务、从备份恢复、继续运行旧版本，更新回到“待确认”并显示失败原因与出错的迁移文件。
7. `account` 库数量可能很多，不在第 2–3 步一次性升级：每个用户库在该账号下一次请求前按需升级（同一个库同时只有一个升级），目标系统也可以在后台逐个升级；某个用户库升级失败时只影响该账号，并记录日志。

### 5.5 降级与重装

- 安装比当前更低的版本时，如果数据库中有新版本才有的迁移，目标系统拒绝安装。
- 卸载时按目标系统的数据保留策略保留或删除数据库；保留期内重新安装同一应用，已执行的迁移按第 5.3 节核对后继续使用。

## 6. 开发与本地运行

商店提供 Go SDK 与本地运行器：在开发机上模拟目标系统的宿主能力、执行迁移，直接用 `go test` 测试后端；`appcheck check` 校验导入的宿主函数、迁移文件规则与清单声明是否一致。
