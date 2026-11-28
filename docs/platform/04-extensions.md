# 扩展点规范

通过 `manifest.json` 的 `platform.provides`，应用可以把自身能力无缝挂载到目标系统的管理表单、文件右键菜单或数据导入入口，无需各自重复开发宿主管理界面。

> **尺寸与校验**：每个声明式扩展点参数对象上限 `8 KB`，安装时由目标系统严格校验，不合法将直接拒绝安装。

## 1. `settings`：统一应用设置

声明 `settings` 后，目标系统会在「应用管理」自动渲染可视化配置表单并校验持久化，供管理员统一维护全应用共用配置：

```json
{
  "platform": {
    "provides": {
      "settings": {
        "fields": [
          {
            "key": "default_view",
            "type": "select",
            "title": "默认视图",
            "options": ["list", { "value": "board", "title": "看板" }],
            "default": "list"
          },
          {
            "key": "page_size",
            "type": "number",
            "title": "每页条数",
            "min": 5,
            "max": 100,
            "integer": true,
            "default": 20
          },
          {
            "key": "welcome_text",
            "type": "text",
            "title": "欢迎语",
            "description": "空状态时展示的简短文案",
            "required": true,
            "maxLength": 100
          },
          {
            "key": "show_archived",
            "type": "boolean",
            "title": "显示已归档",
            "default": false
          }
        ]
      }
    }
  }
}
```

### 字段规则

| 属性 | 约束 |
| --- | --- |
| `fields` | 最多 32 项；为空时不展示设置入口 |
| `key` | 匹配 `^[a-z][a-z0-9_]{0,31}$`，应用内唯一 |
| `type` | `text`（单行，默认 200 / 最大 2000 字，可选 `options` 提供逗号分隔快捷标签）、`textarea`（多行，上限 4000 字）、`number`（支持 `min` / `max` / `integer`）、`boolean`、`select`（`options` 1–50 项，字符串或 `{ value, title }`） |
| `title` / `description` | `title` ≤ 32 字（缺省回退 `key`），`description` ≤ 200 字，不含控制字符 |
| `default` | 须满足对应字段校验规则；应用升级移除旧键时自动丢弃，非法旧值回落默认值 |

- **读取方式**：前端调用 `{ capability: "settings", action: "get" }`，后端调用 `appkit.SettingsGet()`（无需额外在 `platform.uses` 重复声明）。
- **安全警示**：所有有权使用本应用的账号都能读取 `settings`，**严禁用来保存密码、Token 或密钥**（机密配置请使用 `backend.config` 并设 `"secret": true`）。

## 2. `open_with`：文件管理「用…打开」

要求应用包含窗口界面（`entry`）。声明支持的文件类型后，用户可在系统文件管理中右键匹配文件直接唤起本应用：

```json
{
  "platform": {
    "provides": {
      "open_with": {
        "types": ["text/markdown", ".md", "image/*"],
        "path": "/viewer/"
      }
    }
  }
}
```

| 属性 | 约束 |
| --- | --- |
| `types` | 1–20 项，支持精确 MIME、`type/*` 或扩展名（不区分大小写），**禁止 `*/*`** |
| `path` | 可选，打开时加载的包内页面路径（缺省为 `surfaces.home`） |

### 运行时参数流转

1. 目标系统校验文件可读且类型匹配后，签发一次性读取地址；
2. 新建窗口时在 `init` 事件的 `params.openWith` 注入 `{ name, mediaType, size, url, expiresAt }`；
3. 若窗口已打开，则派发 `app:params:{appId}` 事件传递新的 `params.openWith`；
4. 一次性启动参数不写入工作区恢复状态，刷新页面后不会重放。

## 3. `builtin_import`：内置配置导入

供需要承接目标系统历史内置数据的后端应用使用（要求应用声明 `backend`）：

```json
{
  "platform": {
    "uses": ["files.reference"],
    "provides": {
      "builtin_import": {
        "sources": ["<source-id>"],
        "route": "/import/builtin"
      }
    }
  }
}
```

- `route` 必须在 `backend.routes` 中声明为非 `public` 的 `POST` 路由；
- 管理员在应用管理触发导入时，宿主以 `context.entry = "import"` 调用该路由，请求体上限 `1 MB`，包含导出的结构化配置、关联文件元数据列表与缺失文件列表；
- 宿主会以文件所有者名义自动登记相关文件的 `files.reference` 引用；若后端返回 `status >= 400`，宿主自动撤回本次新登记的引用；导入逻辑应支持幂等覆盖重复执行。
