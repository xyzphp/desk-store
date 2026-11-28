# 能力总览

平台接口 v1 定义了格式 2 应用与目标系统交互的标准输出能力。应用在 `manifest.json` 的 `platform.uses` 中按最小权限声明所需能力，或在 `platform.provides` 中注册声明式扩展点；未声明的能力调用会被宿主直接拒绝。

完整底层合同见 [平台接口 v1 规范](../spec/04-platform-v1.md)。

```json
{
  "requires": { "platform": 1 },
  "platform": {
    "uses": ["identity", "ui", "notify", "workspace.state"],
    "provides": {
      "settings": { "fields": [] }
    }
  }
}
```

## 1. 能力分类地图

| 能力域 | 能力名（`platform.uses`） | 调用端 | 详细文档 |
| --- | --- | --- | --- |
| **身份与组织** | `identity`、`directory.pick` | 前端 / 后端（`identity`） | 本页第 2 节 |
| **系统交互与状态** | `ui`、`notify`、`workspace.state` | 前端 / 后端（`notify`） | 本页第 3 节 |
| **文件与媒体** | `files.pick`、`files.save`、`files.reference`、`image.sanitize` | 前端 / 后端 | [文件与媒体](02-files-and-media.md) |
| **托管 AI** | `ai.complete`、`ai.image`（附带 `ai.models` 查询） | 前端 / 后端（仅补全） | [AI 接口](03-ai-and-models.md) |
| **声明式扩展点** | `provides.settings`、`provides.open_with`、`provides.builtin_import` | 宿主管理面集成 | [扩展点规范](04-extensions.md) |
| **AI 工具与技能** | 顶层 `mcp` 与 `skills` 字段 | 宿主 AI 助手 | [MCP 与技能](05-mcp-and-skills.md) |
| **多端与公开入口** | 顶层 `surfaces` 字段 | 窗口 / 独立页 / 公开页 | [入口与公开页](06-surfaces-and-public.md) |

> **兼容性自动标记**：清单中声明的每一项都会自动生成 `uses.<能力名>` 或 `provides.<扩展点>` 能力标记；目标系统仅实现其中一部分时，安装前会自动提示缺少的能力。

## 2. 身份与成员选择

### `identity`：读取当前调用者脱敏身份

- **前端调用**：`method: "platform"`, `{ capability: "identity", action: "me" }`；
- **后端调用**：`appkit.IdentityMe()`（仅已认证入口可用）；
- **返回结构**：`{ id, displayName, avatarUrl? }`。为保护隐私，不返回登录用户名、邮箱或手机号。

### `directory.pick`：系统选人弹窗

- **前端调用**：`{ capability: "directory.pick", action: "pick", payload: { multiple?: boolean } }`；
- **返回结构**：选中成员数组 `[{ id, displayName }]`，用户取消时返回 `null`；
- **隔离边界**：应用无法主动枚举系统全量用户，且选人弹窗仅展示已获授本应用的成员。

## 3. 界面交互、通知与工作区恢复

### `ui`：原生提示、对话框与跨应用导航

| `action` | `payload` | 说明 |
| --- | --- | --- |
| `toast` | `{ title, message?, type?: "info" \| "success" \| "error" }` | 弹出系统统一轻提示条 |
| `alert` / `confirm` | `{ title, message?, okText?, cancelText?, danger? }` | 弹出系统确认框，`confirm` 返回布尔值 |
| `openApp` | `{ id, params? }` | 打开当前用户有权使用的其他应用（`params.openWith` 会被剥离） |
| `openPublicSite` | `{ path? }` | 在新标签页打开本应用已启用的公开入口（`path` 仅允许站内相对路径） |
| `resolveLink` / `openLink` | `{ uri }` | 解析或打开 `xyzos://app/{slug}/{path}` 跨应用深链 |

### `notify`：站内通知

- **前端调用**：`{ capability: "notify", action: "send", payload: { title, body? } }`，仅发给**调用者本人**；
- **后端调用**：`appkit.NotifySend(title, body, userID)`，存在调用者时 `userID` 可省，无调用者（如定时任务）时必填；目标账号必须正常且已获授本应用；
- **字段约束**：标题 1–100 字，正文 ≤ 500 字，受系统频率限制。

### `workspace.state`：刷新状态恢复

因沙箱禁用了 `localStorage`，有状态界面应通过 `workspace.state` 保存筛选条件、选中项与未提交草稿：

- **读取**：页面加载时随 `init` 事件的 `workspaceState` 下发，也可调用 `{ capability: "workspace.state", action: "get" }`；
- **保存**：调用 `{ capability: "workspace.state", action: "save", payload: <可 JSON 序列化对象> }`，按账号与窗口独立存储在服务端；
- **安全约束**：仅存放界面恢复字段，**严禁保存密码、密钥或令牌**，且恢复时不得自动提交发布或重放删除动作。
