# 校验与打包

`appcheck` 是仓库内置的 Go 命令行工具，本地开发校验与 CI 发布流水线共享同一实现。在仓库根目录运行：

```sh
go run ./cmd/appcheck <子命令> [参数]
```

## 1. 子命令速查

| 命令 | 说明 | 示例 |
| --- | --- | --- |
| `check [路径 ...]` | 校验应用目录、包目录或 ZIP；省略参数校验全部 `apps/` | `go run ./cmd/appcheck check apps/my-app` |
| `pack <目录> [-o 文件]` | 按确定性规则打包为 ZIP | `go run ./cmd/appcheck pack apps/my-app -o my-app.zip` |
| `summary <目录> [-base 源]` | 输出权限摘要；指定 `-base` 时对比线上版本高亮新增权限 | `go run ./cmd/appcheck summary apps/my-app` |
| `build [-out dist/public]` | 从 `apps/` 与 `advisories/` 构建商店静态数据 | `go run ./cmd/appcheck build -out dist/public` |
| `sign -out dist/public [-dev-key 文件]` | 使用发布密钥或本地联调密钥签名 | `go run ./cmd/appcheck sign -out dist/public -dev-key dist/dev-signing.key` |
| `verify <目录>` | 离线核验商店静态目录的签名与安装包 SHA-256 | `go run ./cmd/appcheck verify dist/public` |
| `keygen` | 生成新的 Ed25519 密钥对与公钥指纹 | `go run ./cmd/appcheck keygen` |

## 2. 格式 2 自动构建与静态核验

当应用存在 `build.json` 时，`check`、`pack`、`summary` 和 `build` 会自动在临时目录完成构建并校验：

1. 使用登记工具链（Node 22 + `pnpm` / Go 1.26）构建界面与 Wasm 后端；本地版本差异仅提示，CI 严格校验；
2. 静态扫描 `backend/app.wasm`：核验导出了 `memory`、`_initialize`、`handle`（可选 `migrate`），且仅从 `wasi_snapshot_preview1` 和 `host` 导入清单已声明的能力函数；
3. 校验迁移文件编号连续性、SQL 白名单及历史摘要不可变；
4. 校验 MCP `input_schema` 子集与 `skills/*/SKILL.md` Frontmatter 及引用工具存在性。

## 3. 确定性打包与复现

`appcheck pack` 按字典序排列文件、固定时间戳与权限并采用 Store 模式，同一源码提交在任意操作系统都能产出字节完全一致的 ZIP：

```sh
go run ./cmd/appcheck pack apps/my-app -o my-app.zip
shasum -a 256 my-app.zip
```

## 4. 本地联调与预览商店

### 上传 ZIP 联调

运行 `appcheck pack` 生成 ZIP 后，在目标系统「应用管理 → 安装应用」上传测试。同 `slug` 重复上传会覆盖并重回确认状态，联调阶段不必每次升版本号。

### 启动本地商店联调签名全链路

```sh
git submodule update --init   # 首次拉取 desk-ui 子模块
pnpm install                  # 仓库根目录安装工作区依赖
pnpm start                    # 构建签名本地数据并启动 http://localhost:5180
```

- 仅修改 `web/` 或 `docs/` 时可直接运行 `pnpm dev` 热重载；
- 修改 `apps/` 后运行 `pnpm data` 刷新静态数据；
- 本地开发密钥位于 `dist/dev-signing.key`（不入 Git），严禁用于正式发布。

## 5. 常见校验错误速查

| 错误信息 | 原因与处理 |
| --- | --- |
| `unknown field` | `manifest.json` 或 `store.json` 包含规范外字段 |
| `precompiled ... not allowed` | 将构建产物（如 `app.wasm`）直接提交进了 `package/`，应改由 `build.json` 构建 |
| `imports undeclared host capability` | Wasm 后端调用了清单未声明的能力，补全声明或删除多余 SDK 调用 |
| `migration ... modified` / `gap` | 修改了历史迁移文件或编号断层，只能追加新编号文件 |
| `skill ... references unknown tool` | `SKILL.md` 头部 `tools` 引用了未在 `mcp.tools` 定义的工具 |
| `format must be 2` | 使用了格式 2 字段但 `format` 仍写为 `1` |
