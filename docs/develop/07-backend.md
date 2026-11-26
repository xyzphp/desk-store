# 后端模块开发指南（ABI 1）

格式 2 应用可以携带一个编译为 WebAssembly（WASI preview 1 reactor）的 Go 后端模块，由目标系统按请求实例化执行，并按清单声明提供隔离数据库、文件目录、安装配置、外部 HTTP、代理、系统接口、平台能力、公开回调与定时任务。

完整协议定义见 [后端模块、存储与数据库迁移](../spec/02-backend.md)。

## 1. 目录结构与 `build.json`

后端源码存放在应用目录下的 `backend/`，是一个独立的 Go 模块，并在应用根目录声明 `build.json`：

```text
apps/<slug>/
  build.json
  store.json
  README.md
  CHANGELOG.md
  backend/
    go.mod
    main.go
    main_test.go
  package/
    manifest.json
    icon.svg
    index.html
    backend/
      migrations/
        shared/0001_init.sql
        account/0001_init.sql
```

`build.json`：

```json
{
  "backend": { "toolchain": "go@1.26", "abi": 1 }
}
```

仓库中**不得提交**预编译的 `package/backend/app.wasm`；执行 `appcheck check` / `pack` / `build` 时会自动以固定参数从 `backend/` 构建：

```sh
GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 GOFLAGS=-mod=readonly \
  go build -buildmode=c-shared -trimpath -buildvcs=false -ldflags=-buildid= -o app.wasm .
```

在商店仓库内开发示例应用时，`backend/go.mod` 可通过本地相对 `replace` 引用仓库自带的 SDK（无需外网拉取依赖）：

```text
module example.com/my-app/backend

go 1.26.10

require github.com/xyzphp/desk-store v0.0.0

replace github.com/xyzphp/desk-store => ../../..
```

## 2. 使用 Go SDK（`sdk/appkit`）

`github.com/xyzphp/desk-store/sdk/appkit` 封装了全部 ABI 1 宿主能力，且按能力拆分为独立函数——**未调用的宿主能力不会被编译进 Wasm 导入表**，因此不会触发“导入了清单未声明的能力”校验失败。

最小后端入口：

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

### 常用能力速查

| 能力 | SDK 调用 | 需要的清单声明 |
| --- | --- | --- |
| 数据库（`database/sql`） | `appkit.OpenDB("shared" \| "public" \| "account")` | `backend.storage` 对应范围 |
| 轻量数据库 / 事务 | `appkit.DB(scope).Query / Exec / Begin` | `backend.storage` 对应范围 |
| 键值存储（KV） | `appkit.KV(scope).Get / Set / Delete / List` | `backend.storage` 对应范围 |
| 受限文件与直传 | `os.Open(appkit.DataPath("shared", "a.txt"))`、`c.ParseUpload()`、`c.SendFile(...)` | `backend.storage` 对应范围 |
| 安装配置 | `appkit.Config("key")` | `backend.config` |
| 日志 | `appkit.LogDebug / LogInfo / LogWarn / LogError` | 无 |
| 外部 HTTP | `appkit.HTTPFetch(...)` / `appkit.NewHTTPClient()` | `backend.http.allow` |
| 声明式代理 | `appkit.ProxyFetch(...)` | `proxies` |
| 系统 API（以调用者身份） | `appkit.APICall(...)` | `gateway_api`（仅已认证调用者） |
| 平台能力 | `appkit.SettingsGet` / `IdentityMe` / `NotifySend` | `platform.uses` 或 `provides.settings` |
| 公开回调 | `r.HandleHook("POST", "payment", fn)` | `backend.hooks` |
| 定时任务 | `r.HandleSchedule("/jobs/daily", fn)` | `backend.schedules` + `POST` 路由 |
| 迁移数据钩子 | `//go:wasmexport migrate` + `appkit.DispatchMigrate(fn)` | 可选导出 |

## 3. 数据库迁移

表结构变更全部通过 `package/backend/migrations/<scope>/NNNN_<名称>.sql` 完成：

- `scope` 必须在 `backend.storage` 中启用（`shared`、`public` 或 `account`）；
- 文件编号从 `0001` 开始严格连续递增，名称仅含小写字母、数字与连字符；
- 已发布的迁移文件**不可修改、不可删除、不可重编号**，只能追加新文件；
- 运行时 `db_call` 禁止执行 DDL、`ATTACH`、`VACUUM`、`PRAGMA` 或读写 `_app_migrations` / `_app_kv`；
- 需要在 SQL 迁移后做代码级数据转换时，导出 `migrate() -> i32` 并在其中调用 `appkit.DispatchMigrate`。

## 4. 本地测试（`sdk/apphost`）与 `appcheck`

在 `backend/main_test.go` 中使用 `github.com/xyzphp/desk-store/sdk/apphost`，无需编译 Wasm 即可在本机执行迁移并测试路由、权限、事务与外部能力桩：

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

提交前在商店根目录运行校验：

```sh
go run ./cmd/appcheck check apps/<slug>
```

`appcheck check` 会依次构建 Wasm、校验清单与迁移文件、并静态检查 Wasm 导出与 `host.*` 导入是否与清单完全一致。
