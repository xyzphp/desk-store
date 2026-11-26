# 参与贡献

## 提交应用

按[快速开始](docs/develop/01-quick-start.md)与[提交与评审](docs/site/03-submit.md)操作。PR 描述里请说明：

- 应用的用途；
- 需要访问的外部服务、系统接口，以及为什么需要它们；
- 如何测试（例如需要什么样的上游服务）。

## 修改商店本身

| 改动 | 需要同时维护 |
| --- | --- |
| 包格式或清单规则（`pkg/appspec`） | `docs/develop/` 中的对应说明与测试；规则必须与目标系统安装时的校验一致，放宽规则前先确认目标系统已支持 |
| 静态数据格式（`pkg/appspec/catalog.go`） | `web/src/api.ts`、`docs/self-host/02-data-format.md`；不兼容的变化使用新的 `api/v2/` 目录 |
| 签名内容 | 修改 `SignaturePrefix`，并在文档中说明迁移方式 |
| 网站 | 使用 `@xyzos/desk-ui`（子模块 `desk-ui/` 的源码）的组件与设计令牌，缺少的通用组件先到 desk-ui 补建；文字不小于 12px，保留键盘操作与深浅色 |

提交前运行：

```sh
gofmt -l . && go vet ./... && go test ./...
go run ./cmd/appcheck check
pnpm install && pnpm typecheck && pnpm build   # 仓库根目录，需要先初始化 desk-ui 子模块
```

## 发布

发布只由推送到 `main` 后的 `Publish` 工作流完成，不在本地发布，也不手工创建 Release。签名私钥只存在于 `store-publish` 环境中。
