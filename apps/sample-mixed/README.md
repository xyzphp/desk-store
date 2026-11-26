# 混合示例

演示[应用包格式 2](../../docs/spec/01-package-v2.md)的完整组合：

- **界面**：`src/` 中的源码由 CI 按 `build.json` 构建后放进安装包；
- **后端**：`backend/` 是独立的 Go 模块，CI 构建为 `backend/app.wasm`，`package/backend/migrations/` 带共享库的迁移；
- **AI 工具**：一个声明式工具（经代理查询示例接口）与一个后端工具；
- **技能**：`note-taking` 说明如何用工具记笔记；
- **访问控制**：应用内权限、独立页面与公开页面。

格式 2 仍是草案：只支持格式 1 的系统会把它标记为“当前系统不支持”。后端接口（ABI 1）的 SDK 尚未发布，`backend/main.go` 目前只是可构建的占位。
