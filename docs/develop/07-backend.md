# 后端开发

格式 2 应用可携带编译为 WebAssembly（WASI preview 1 reactor）的 Go 后端模块（ABI 1）。目标系统按请求实例化执行，按清单白名单提供隔离 SQLite、受限文件目录、安装配置、外部 HTTP、代理、平台能力、个人令牌 API、公开回调与定时任务。

完整底层协议见 [后端模块、存储与数据库迁移规范](../spec/02-backend.md)。

> **无状态执行模型**：每次请求独立实例化、结束后销毁，请求间不共享内存；持久状态必须写入 `db_call`、`kv_call` 或 `/data` 受限目录。

## 1. 目录结构与 `build.json`

后端是位于 `apps/<slug>/backend/` 的独立 Go 模块，根目录配置 `build.json`：

```json
{
  "backend": { "toolchain": "go@1.26", "abi": 1 }
}
```

禁止提交预编译的 `package/backend/app.wasm`。`appcheck` 与 CI 以固定参数编译：

```sh
GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 GOFLAGS=-mod=readonly \
  go build -buildmode=c-shared -trimpath -buildvcs=false -ldflags=-buildid= -o app.wasm .
```

在仓库内开发时，可在 `backend/go.mod` 使用相对路径引用内置 SDK：

```text
module example.com/my-app/backend

go 1.26.10

require github.com/xyzphp/desk-store v0.0.0

replace github.com/xyzphp/desk-store => ../../..
```

## 2. 使用 Go SDK（`sdk/appkit`）

`github.com/xyzphp/desk-store/sdk/appkit` 按能力拆分宿主绑定，**未调用的函数不会进入 Wasm 导入表**：

```go
package main

import (
	"net/http"

	"github.com/xyzphp/desk-store/sdk/appkit"
)

func buildRouter() *appkit.Router {
	r := appkit.NewRouter()
	r.Get("/items", func(c *appkit.Context) {
		db := appkit.OpenDB("shared")
		rows, err := db.Query(`SELECT id, title FROM items ORDER BY id DESC`)
		if err != nil {
			c.Error(http.StatusInternalServerError, err.Error())
			return
		}
		defer rows.Close()
		var items []map[string]any
		for rows.Next() {
			var id int64
			var title string
			if err := rows.Scan(&id, &title); err == nil {
				items = append(items, map[string]any{"id": id, "title": title})
			}
		}
		c.JSON(http.StatusOK, map[string]any{"ok": true, "items": items})
	})
	return r
}

//go:wasmexport handle
func handle() int32 {
	return appkit.Dispatch(buildRouter())
}

func main() {}
```

单请求默认超时 `5` 秒、内存 `64 MB`、并发 `8`、请求与响应信封各 `1 MB`；可在 `backend.limits` 中将超时最高设至 `30000 ms`、内存最高设至 `256 MB`。

## 3. 路由、审计日志与个人令牌

在 `backend.routes` 声明全部接口（≤ 64 条）：

```json
{
  "backend": {
    "runtime": "wasm",
    "abi": 1,
    "module": "backend/app.wasm",
    "token_scopes": [
      { "id": "read", "label": "读取", "description": "读取列表与详情" },
      { "id": "write", "label": "写入", "description": "创建或修改数据" }
    ],
    "routes": [
      { "path": "/items", "methods": ["GET"], "visibility": "app", "token_scope": "read" },
      {
        "path": "/items",
        "methods": ["POST"],
        "visibility": "permission:item.write",
        "token_scope": "write",
        "audit": { "action": "create_item", "label": "新建记录" }
      },
      { "path": "/me/prefs", "methods": ["PUT"], "visibility": "app", "audit": { "mode": "off" } },
      { "path": "/public/items", "methods": ["GET"], "visibility": "public", "rate_limit": "60/min" }
    ]
  }
}
```

- **可见性（`visibility`）**：`public`（匿名只读 `public` 存储）、`signed_in`（任意登录用户）、`app`（获授本应用用户）、`permission:<name>`（需指定应用内子权限）；
- **操作日志（`audit`）**：默认（或 `mode: "write"`）自动记录已认证写操作（建议填写固定 `action` 与 `label`）；`mode: "all"` 全量入账（禁止用于 `public`）；`mode: "off"` 关闭入账且不能写 `action` / `label`；
- **个人令牌（`token_scopes`）**：最多 16 项，非公开路由绑定 `token_scope` 后支持 `Authorization: Bearer` 访问（`c.Entry() == "token"`），仍强制校验账号实时权限并禁用 `api_call`。

## 4. 三类隔离存储与数据库迁移

| 范围 | SQLite 数据库 | 文件目录 | 边界说明 |
| --- | --- | --- | --- |
| `shared` | 共享库 | `/data/shared` | 授权用户经后端访问，由后端按 `c.Permissions()` 鉴权 |
| `public` | 公开库 | `/data/public` | 后端可读写；`public` 路由与入口严格只读 |
| `account` | 每账号独立库 | `/data/me` | 宿主自动只打开当前登录账号自己的库与目录 |

- 表结构变更全部通过 `package/backend/migrations/<scope>/NNNN_<名称>.sql` 完成（四位编号从 `0001` 严格递增）；
- 运行时 `db_call` 禁止 DDL、`ATTACH`、`VACUUM`、`PRAGMA` 及访问保留表 `_app_migrations` / `_app_kv`；
- **已发布迁移不可修改、删除或重编号**，仅可向后追加；如需代码级数据转换，可导出可选入口 `migrate() -> i32` 并调用 `appkit.DispatchMigrate`；
- 大文件上传通过 `backendUpload` + `c.ParseUpload()`，大文件输出通过 `c.SendFile(...)` / `c.SendUserFile(...)`，详见 [文件与媒体](../platform/02-files-and-media.md)。

## 5. SDK 能力速查

| 能力 | `sdk/appkit` 调用 | 所需清单声明 |
| --- | --- | --- |
| SQLite / 事务 | `appkit.OpenDB(scope)` / `appkit.DB(scope)` | `backend.storage` |
| 键值存储（KV） | `appkit.KV(scope).Get / Set / Delete / List` | `backend.storage` |
| 受限文件与直传 | `appkit.DataPath`、`c.ParseUpload()`、`c.SendFile(...)` | `backend.storage` |
| 安装配置与密钥 | `appkit.Config("key")` | `backend.config` |
| 应用日志 | `appkit.LogDebug / LogInfo / LogWarn / LogError` | 无 |
| 外部 HTTP | `appkit.HTTPFetch(...)` / `appkit.NewHTTPClient()` | `backend.http.allow` |
| 声明式代理 / 系统 API | `appkit.ProxyFetch(...)` / `appkit.APICall(...)` | `proxies` / `gateway_api` |
| 平台设置 / 身份 / 通知 | `appkit.SettingsGet` / `IdentityMe` / `NotifySend` | `platform.uses` 或 `provides.settings` |
| 引用 / 保存用户文件 | `appkit.FileReferenceRead`、`c.SendUserFile`、`appkit.FileSave` | `platform.uses`（`files.*`） |
| AI 文本补全 | `appkit.AIComplete(messages, options)`（`public` / `hook` 禁用） | `platform.uses: ["ai.complete"]` |
| 公开回调 / 定时任务 | `r.HandleHook(...)` / `r.HandleSchedule(...)` | `backend.hooks` / `backend.schedules` |

## 6. 本地单元测试（`sdk/apphost`）

使用 `github.com/xyzphp/desk-store/sdk/apphost` 可直接在宿主 Go 环境运行迁移并测试路由、权限隔离与能力替身，无需编译 Wasm：

```go
host, err := apphost.NewFromAppDir("..",
	apphost.WithAuthorizedUsers(1, 2),
)
if err != nil {
	t.Fatal(err)
}
defer host.Close()

resp, err := host.Do(appkit.RequestEnvelope{
	Method:  "GET",
	Path:    "/items",
	Context: appkit.RequestContext{User: &appkit.User{ID: 1, DisplayName: "Alice"}},
}, buildRouter())
```
