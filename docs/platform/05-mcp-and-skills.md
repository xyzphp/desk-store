# MCP 与技能

格式 2 定义了标准的 **MCP（工具、只读资源、提示模板）** 与 **技能（Skills）** 契约，让应用能力可以被目标系统的 AI 助手安全发现与调用。应用既可以作为「混合」应用同时提供界面与 AI 能力，也可以作为无界面的纯 MCP 或纯技能包发布。

> **安全约束**：技能目录仅允许纯文本说明与参考资料，**严禁包含脚本文件**；所有可执行动作必须经清单透明声明的 MCP 工具完成，并受权限与用户确认保护。

## 1. 声明 MCP 工具（`mcp.tools`）

单应用最多声明 `64` 个工具，系统内自动加前缀 `<slug>.<name>` 防止命名冲突：

```json
{
  "mcp": {
    "tools": [
      {
        "name": "query_status",
        "title": "查询示例状态",
        "description": "按关键词查询外部示例接口返回的状态数据",
        "input_schema": {
          "type": "object",
          "properties": {
            "keyword": { "type": "string", "maxLength": 100, "description": "查询关键词" }
          },
          "required": ["keyword"]
        },
        "annotations": { "read_only": true },
        "call": {
          "proxy": "upstream",
          "method": "GET",
          "path": "/v1/status",
          "query": { "q": "{keyword}" }
        }
      },
      {
        "name": "create_record",
        "title": "新增记录",
        "description": "以当前用户身份创建一条新记录",
        "input_schema": {
          "type": "object",
          "properties": {
            "title": { "type": "string", "maxLength": 120 },
            "content": { "type": "string", "maxLength": 2000 }
          },
          "required": ["title"]
        },
        "annotations": { "destructive": true },
        "call": { "backend": "/tools/create-record" }
      }
    ]
  }
}
```

### 字段规则

| 字段 | 约束 |
| --- | --- |
| `name` | 匹配 `^[a-z][a-z0-9_]{1,47}$`，应用内唯一 |
| `title` / `description` | 工具显示名与供模型理解的用途说明（`description` 1–500 字） |
| `input_schema` | JSON Schema draft 2020-12 受控子集（`type`、`properties`、`required`、`enum`、`items`、`minimum`、`maximum`、`minLength`、`maxLength`、`description`），≤ 8 KB |
| `annotations` | `read_only`（只读查询）、`destructive`（具写入/删除等副作用；为 `true` 时 AI 助手每次调用前须请求用户确认） |
| `call` | `backend`、声明式 `proxy` 或 `remote` 三选一 |

工具返回结构化 JSON 或文本，单次返回上限 `256 KB`。

### 三种调用形态

1. **后端实现（`{ "backend": "/tools/..." }`）**：将参数 JSON `POST` 至 Wasm 后端，请求上下文 `context.entry` 为 `"tool"`，携带当前用户与权限并受路由 `visibility` 校验。
2. **声明式代理（`{ "proxy": "<key>", "method", "path", "query"?, "body"? }`）**：无需后端，直接映射参数 `{param}` 经已声明 `proxies` 转发，适合轻量只读查询。
3. **远程 MCP（`mcp.remote` + `{ "remote": true }`）**：经受控代理接入独立 MCP 服务，通过 `pinned_tools` 在安装时固定工具白名单；若远程服务工具定义变更，系统将拦截并要求管理员重新确认：

```json
{
  "mcp": {
    "remote": {
      "proxy": "mcp-srv",
      "path": "/mcp",
      "pinned_tools": ["search_items", "get_detail"]
    }
  }
}
```

## 2. 只读资源与提示模板

```json
{
  "mcp": {
    "resources": [
      {
        "uri": "myapp://recent",
        "title": "最近记录",
        "call": { "backend": "/resources/recent" }
      }
    ],
    "prompts": [
      {
        "name": "summarize",
        "title": "总结内容",
        "file": "mcp/prompts/summarize.md"
      }
    ]
  }
}
```

- **`resources`**：最多 32 个只读资源（支持 `backend` 或声明式 `proxy`，不支持 `remote`）；
- **`prompts`**：最多 32 个提示模板，`file` 指向 `package/mcp/prompts/` 下的 Markdown 文件（单文件 ≤ 16 KB）。

## 3. 编写技能（`skills`）

在清单中声明技能名数组（最多 20 项，命名匹配 `^[a-z][a-z0-9-]{1,47}$`）：

```json
{
  "skills": ["workflow-guide"]
}
```

每个技能对应 `package/skills/<name>/SKILL.md`，以 `---` Frontmatter 开头：

```markdown
---
name: workflow-guide
description: 指导 AI 按查询、校验与确认步骤调用本应用工具。
tools:
  - query_status
  - create_record
---

# 标准执行步骤

1. 先调用 `query_status` 获取当前上下文状态。
2. 需要写入时明确展示待提交内容，经用户确认后再调用 `create_record`。
```

### 校验与体积上限

- `name` 必须与目录名一致，`description` 限 1–300 字；
- 可选 `tools` 支持 `[a, b]` 或逐行 `- a` 列表写法，`appcheck` 会校验其中每一项均存在于本应用的 `mcp.tools`；
- 可在 `references/` 放置 `.md`、`.txt`、`.json` 参考资料（禁止脚本）；
- 单份 `SKILL.md` ≤ `32 KB`，全部参考文件合计 ≤ `512 KB`。
