# 协作规范

- 公开仓库：不提交任何下游项目的业务文案、业务标识、内部地址、私有路径、密钥或运行配置；示例使用中性内容与 `example.com`。
- 应用只以源码形式存在于 `apps/<slug>/`；不提交打包好的 ZIP，不手工创建 Release，不在本地签名后提交数据。
- `pkg/appspec` 的规则必须与目标系统安装时的校验一致：只能比目标系统更严格，不能更宽松。改规则时同一改动里更新 `docs/develop/` 与测试。
- 静态数据格式与签名内容是对外合同：修改 `pkg/appspec/catalog.go` 时同步 `web/src/api.ts` 与 `docs/self-host/02-data-format.md`；不兼容的变化使用新的数据目录。
- 网站只使用 `@xyzos/desk-ui` 已发布的组件和设计令牌，文字不小于 12px，保留键盘操作、焦点与深浅色。
- 基础自检：`gofmt -l .`、`go vet ./...`、`go test ./...`、`go run ./cmd/appcheck check`、`pnpm --dir web typecheck`、`pnpm --dir web build`。如实报告运行过的命令与结果；未在浏览器中检查的界面要说明。
- 签名私钥只存在于 `store-publish` 环境；任何脚本、日志与文档都不得输出或要求提供私钥内容。
