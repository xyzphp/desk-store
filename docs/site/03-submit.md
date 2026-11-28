# 提交与评审

所有新应用与版本更新均通过 Pull Request 提交。CI 自动执行规范校验与可复现构建，维护者结合权限增量摘要进行代码评审。

> **基本要求**：提交完整可读源码；需要构建的前端或后端工程通过 `build.json` 交由 CI 构建，不得向仓库提交预编译产物或混淆代码。

## 1. 提交新应用

1. Fork 商店仓库，在 `apps/` 下创建与 `slug` 一致的目录，规范见 [目录与限制](../develop/02-app-directory.md)。
2. 补齐 `package/manifest.json`、`store.json`、`README.md`、`CHANGELOG.md`、矢量或位图图标及源码；格式 2 构建型应用同步提交 `build.json` 与依赖锁文件（`pnpm-lock.yaml` / `go.sum`）。
3. 在仓库根目录运行本地检查并打包到测试系统验证：

```sh
go run ./cmd/appcheck check apps/<slug>
go run ./cmd/appcheck pack apps/<slug> -o <slug>.zip
go run ./cmd/appcheck summary apps/<slug>
```

4. 发起 Pull Request，并在描述中说明：
   - 应用核心用途与使用前提；
   - 声明的外部代理、外联主机、系统接口或平台能力的必要原因；
   - 本地复现与测试方式（使用通用占位示例地址，不含私有地址或凭据）。

## 2. 更新已有应用

- **严格递增版本号**：只要影响了安装包最终字节（包括 `package/`、`src/`、`backend/` 变更），就必须提升 `manifest.json` 的 `version`（严格高于已发布版本），已发布版本号不可复用。
- **维护更新日志**：在 `CHANGELOG.md` 顶部补充 `## <版本号>` 小节，供版本记录时间线展示。
- **历史迁移不可变**：已发布的 `package/backend/migrations/<scope>/NNNN_*.sql` 禁止修改、删除或重编号，只能向后追加新编号文件。
- **纯展示元信息变更**：仅调整 `store.json` 或 `README.md` 且不影响安装包字节时，无需提升版本号。

## 3. CI 自动核验

| 检查项 | 说明 |
| --- | --- |
| 清单与结构 | 拒绝未知字段，检查文件数、体积、图标、截图与扩展名位置约束 |
| 可复现构建 | 带 `build.json` 时用固定工具链构建两次，核对产物摘要完全一致 |
| Wasm 静态校验 | 校验 ABI 1 导出入口以及导入的 `host.*` 函数均已在清单声明 |
| 迁移与 AI 校验 | 核对历史迁移摘要不变性、MCP Schema 子集以及技能引用的工具存在性 |
| 权限增量摘要 | 对比已发布版本，列出新增的路由、存储范围、外联、公开入口与工具 |

## 4. 评审原则

- **最小权限**：`gateway_api`、`proxies` 路径与方法、`backend.http.allow` 主机及 `platform.uses` 仅声明必要范围。
- **边界清晰**：公开路由仅只读 `public` 存储；写操作路由合理标注系统日志策略；有副作用的 MCP 工具标注 `destructive: true`。
- **源码可读与自包含**：不外链第三方 CDN 脚本或样式，不夹带与用途无关的数据上报，不含私有内网地址或真实凭据。
- **许可证合规**：`store.json` 中的 SPDX 标识与源码及附带素材许可一致。

## 5. 下架、撤回与安全披露

- 应用维护者（`CODEOWNERS`）与商店维护者共同审批版本更新。
- 问题版本可通过 `store.json` 的 `yanked` 字段撤回；停止维护的应用可设 `"withdrawn": true` 下架，历史元数据保持可追溯。
- 安全漏洞请按仓库 `SECURITY.md` 私下报告，确认后通过签名安全通告发布修复指引。
