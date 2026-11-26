# 待办协作

带独立后端模块（ABI 1）与双范围隔离存储的格式 2 示例应用，演示如何用 Go SDK（`sdk/appkit`）与本地运行器（`sdk/apphost`）开发完整的全栈扩展应用。

## 包含的能力

- **共享存储（`shared`）**：保存团队看板（`boards`）与任务（`tasks`），包含两个版本的正向 SQL 迁移（`0001_init.sql`、`0002_add-priority.sql`）和 `migrate()` 生命周期钩子。
- **按账号隔离存储（`account`）**：每个账号拥有独立的 SQLite 数据库（`personal_pins`）与 KV，保存个人置顶任务与列表筛选偏好，账号间互不可见。
- **应用内权限（`access.permissions`）**：区分普通浏览（`app`）、编辑任务（`task.write`，默认授予）与管理看板（`board.manage`）。
- **平台能力与设置**：读取管理员维护的默认任务优先级（`provides.settings`），支持发送站内提醒（`notify`），界面直接使用托管组件库。
