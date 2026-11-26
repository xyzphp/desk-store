# 应用包格式 2（草案）

格式 2 在格式 1 的基础上增加四类组件与访问控制。格式 1 的字段与规则全部保留；清单用到本页任一新增字段时，`format` 必须为 `2`。只支持格式 1 的系统会拒绝格式 2 的包，商店据此标记“当前系统不支持”。

## 1. 组件模型

一个应用由下列组件任意组合，商店与系统按包含的组件显示类型标签：

| 组件 | 判定 | 说明 |
| --- | --- | --- |
| `ui` | 声明了 `entry` 或 `gateway_page` | 窗口界面（格式 1 已有），可带桌面卡片 |
| `backend` | 声明了 `backend` | 后端模块，见 [02](02-backend.md) |
| `mcp` | 声明了 `mcp` | 供 AI 调用的工具、资源与提示模板 |
| `skills` | 声明了 `skills` | 技能说明（只含文字与数据） |

类型标签：只有 `ui`（可带 `backend`）为“应用”，只有 `mcp` 为“MCP”，只有 `skills` 为“技能”，其他组合为“混合”。没有 `ui` 的应用不出现在桌面与程序坞。

## 2. 包目录与上限

```text
package/
  manifest.json
  icon.svg
  index.html, assets/…          # ui：构建产物（商店 CI 从 src/ 构建，见第 7 节）
  backend/app.wasm               # backend：商店 CI 从 backend/ 源码构建
  backend/migrations/<scope>/NNNN_<name>.sql
  mcp/prompts/<name>.md
  skills/<name>/SKILL.md
  skills/<name>/references/…
```

| 项 | 格式 1 | 格式 2 |
| --- | --- | --- |
| 解压后总量（含 manifest.json） | 1 MB | 16 MB |
| ZIP 本体 | 2 MB | 18 MB |
| 文件数（含 manifest.json） | 32 | 500 |
| manifest.json | 32 KB | 64 KB |
| 单文件 | 1 MB | 2 MB（`backend/app.wasm` 8 MB） |
| 扩展名 | `.html .css .js .json .svg .png .jpg .jpeg .webp .woff2 .txt` | 另加 `.md .sql .wasm .map` |

新增扩展名只能出现在固定位置：`.wasm` 只能是 `backend/app.wasm`，`.sql` 只能在 `backend/migrations/` 下，`.md` 只能在 `skills/` 或 `mcp/prompts/` 下；`skills/` 下只允许 `.md`、`.txt`、`.json`；`backend/` 下只允许模块与 `migrations/`。

`backend/app.wasm` 与 `ui` 构建产物只能由商店 CI 生成，提交到仓库的预编译文件会被 `appcheck` 拒绝（见第 7 节）。

## 3. 清单新增字段

| 字段 | 说明 |
| --- | --- |
| `requires` | `{ "platform": 1 }`：所需的平台接口大版本。省略时为 `1` |
| `access` | 应用内权限与默认授予，见第 4 节 |
| `surfaces` | 界面入口与页面可见范围，见第 5 节 |
| `platform` | 使用的平台能力与提供的扩展点，见第 6 节 |
| `backend` | 后端模块，见 [02](02-backend.md) |
| `mcp` | AI 工具、资源、提示模板，见第 8 节 |
| `skills` | 技能列表，见第 9 节 |

格式 1 的 `permissions`（`proxy.<key>`）含义不变；应用内权限使用 `access.permissions`，两者不要混用。

格式 2 的应用至少包含界面（`entry` / `gateway_page`）、`mcp` 或 `skills` 之一；没有界面的应用不能声明 `desktop_widget`、`widget`、`window` 与 `surfaces`。

## 4. access：应用内权限与默认授予

```json
{
  "access": {
    "permissions": [
      { "name": "article.write", "title": "写作与管理本人文章" },
      { "name": "article.publish", "title": "发布与撤回" },
      { "name": "site.settings", "title": "站点设置" }
    ],
    "default_grant": "all_accounts"
  }
}
```

| 字段 | 规则 |
| --- | --- |
| `permissions[].name` | `^[a-z][a-z0-9_.-]{1,47}$`，应用内唯一；系统登记为 `<slug>:<name>`，出现在账号与角色的权限树中 |
| `permissions[].title` | 1–32 个字符 |
| 数量 | ≤ 32 |
| `default_grant` | `none`（默认）、`all_accounts`（安装时授予现有账号）、`all_accounts_and_new`（并对新账号自动授予）；系统在安装确认时展示，管理员可以改为 `none` |

默认授予只授予应用本身；`permissions` 中的子权限需要另行授予，除非在 `permissions[].default` 中写 `true`（同样在安装确认中展示）。

## 5. surfaces：界面入口与可见范围

```json
{
  "surfaces": {
    "home": "/",
    "window": { "pages": [{ "path": "/", "visibility": "app" }, { "path": "/settings/", "visibility": "permission:site.settings" }] },
    "standalone": { "enabled": true },
    "public": { "pages": [{ "path": "/", "visibility": "public" }], "alias": "/articles", "session": "optional" }
  }
}
```

| 字段 | 规则 |
| --- | --- |
| `home` | 窗口打开时的首页路径，默认 `/` |
| `window.pages` / `public.pages` | 页面路径前缀与可见范围；按最长前缀匹配，未列出的路径沿用 `app` |
| `visibility` | `public`、`signed_in`、`app`、`permission:<name>`；`public` 只能出现在 `public` 入口 |
| `standalone.enabled` | 允许在浏览器新标签页 `{站点根}/apps/<slug>/…` 打开 |
| `public` | 公开入口 `{站点根}/p/<slug>/…`；系统默认关闭，管理员开启后生效 |
| `public.alias` | 希望绑定的站点路径（如 `/articles`），仅为建议，由管理员确认；不能占用系统保留路径 |
| `public.session` | `none`（默认，匿名）或 `optional`（已登录时把调用者身份交给后端，页面仍运行在沙箱中） |

`dialog`、`panel`、`share` 入口在后续版本加入。

## 6. platform：平台能力与扩展点

```json
{
  "platform": {
    "uses": ["identity", "ui", "notify", "files.pick", "workspace.state"],
    "provides": { "settings": { "fields": [] }, "account_deleted": { "route": "/hooks/account-deleted" } }
  }
}
```

| 字段 | 规则 |
| --- | --- |
| `uses` | 平台能力名单，取值见下表；未声明的能力调用会被拒绝 |
| `provides` | 扩展点及其参数；需要运行代码的扩展点必须带 `backend` |

平台接口 v1 的能力名：`identity`、`directory.pick`、`ui`、`notify`、`files.pick`、`files.save`、`files.reference`、`workspace.state`、`image.sanitize`、`ai.complete`、`ai.image`、`tasks`、`realtime`、`audit`。

扩展点：`settings`、`open_with`、`widget`、`lifecycle`、`account_deleted`、`health`、`search`、`notification_action`、`export`。各能力与扩展点的接口细节由目标系统的平台接口文档定义；目标系统只支持其中一部分时，商店按第 10 节的能力标记显示“当前系统不支持”。

## 7. 源码与构建

```text
apps/<slug>/
  store.json  README.md  CHANGELOG.md  LICENSE  screenshots/
  package/              # 不需要构建的文件：manifest.json、图标、迁移、技能、提示模板
  src/                  # 可选：界面源码（Node 工程），CI 构建到 package/
  backend/              # 可选：后端源码（Go 模块），CI 构建为 package/backend/app.wasm
  build.json            # 有 src/ 或 backend/ 时必需，声明构建方式
```

```json
{ "ui": { "toolchain": "node@22", "command": "build", "output": "dist" }, "backend": { "toolchain": "go@1.26", "abi": 1 } }
```

- `ui.toolchain` 与 `backend.toolchain` 只能取商店登记的固定工具链；CI 在固定版本的容器中执行 `pnpm install --frozen-lockfile` 与 `pnpm run <command>`，把 `output` 复制到 `package/`。界面源码必须提交锁文件。
- 后端用 `GOOS=wasip1 GOARCH=wasm go build -trimpath` 构建，构建参数由商店固定，应用不能自定义。
- 构建必须可复现：同一提交重复构建得到相同的文件；CI 在 Pull Request 中构建两次比较摘要。
- 构建产物不提交到仓库。目标系统可以直接复用托管的组件库（`@xyzos/desk-ui`）构建，界面工程把它标为外部依赖以减小体积，具体方式见目标系统的开发文档。

## 8. mcp：AI 工具、资源与提示模板

```json
{
  "mcp": {
    "tools": [
      {
        "name": "list_articles",
        "title": "列出文章",
        "description": "列出当前用户的文章标题与状态",
        "input_schema": { "type": "object", "properties": { "status": { "type": "string", "enum": ["draft", "published"] } } },
        "annotations": { "read_only": true },
        "call": { "backend": "/tools/list-articles" }
      }
    ],
    "resources": [{ "uri": "articles://recent", "title": "最近的文章", "call": { "backend": "/resources/recent" } }],
    "prompts": [{ "name": "outline", "title": "生成文章大纲", "file": "mcp/prompts/outline.md" }]
  }
}
```

| 字段 | 规则 |
| --- | --- |
| `tools[].name` | `^[a-z][a-z0-9_]{1,47}$`，应用内唯一；系统内以 `<slug>.<name>` 区分 |
| `tools[].description` | 1–500 个字符 |
| `tools[].input_schema` | JSON Schema（draft 2020-12 的子集：`type`、`properties`、`required`、`enum`、`items`、`minimum`、`maximum`、`minLength`、`maxLength`、`description`），≤ 8 KB |
| `tools[].annotations` | `read_only`、`destructive`（布尔）；`destructive` 的工具在系统内的 AI 助手中每次调用前请用户确认 |
| `tools[].call` | 三选一：`{ "backend": "<路由>" }`（需要 `backend`）、`{ "proxy": "<key>", "method": "GET", "path": "/now", "query": {"city": "{city}"}, "body": {…} }`（声明式，只能用已声明代理的路径与方法）、`{ "remote": true }`（来自 `mcp.remote`） |
| `resources[]` | 只读资源，`call` 同上（不支持 `remote`） |
| `prompts[]` | 提示模板，`file` 为包内 Markdown，≤ 16 KB |
| `remote` | `{ "proxy": "<key>", "path": "/mcp", "pinned_tools": ["…"] }`：接入独立部署的 MCP 服务；系统安装时固定工具清单，远程变化需管理员重新确认 |
| 数量 | 工具 ≤ 64，资源 ≤ 32，提示模板 ≤ 32 |

工具返回结构化 JSON 或文本，≤ 256 KB。

## 9. skills：技能

```json
{ "skills": ["writing-style", "seo-checklist"] }
```

- 每项对应 `package/skills/<name>/SKILL.md`，名称为 `^[a-z][a-z0-9-]{1,47}$`。文件以 `---` 包围的头部开始，必须有 `name`（与目录名一致）与 `description`（1–300 个字符），可选 `tools`（引用的本应用工具名，写成 `[a, b]` 或逐行 `- a`）；头部只支持 `key: value` 与这两种列表写法。正文为步骤与规则。
- 可带 `references/` 下的参考文件（`.md`、`.txt`、`.json`）；**不允许脚本**，需要执行的动作写成本应用的工具，在头部 `tools` 中列出，`appcheck` 校验这些工具在 `mcp.tools` 中存在。
- 上限：技能 ≤ 20 个，单个 `SKILL.md` ≤ 32 KB，参考文件合计 ≤ 512 KB。

## 10. 能力标记

商店根据清单自动生成版本的 `capabilities`，目标系统据此判断能否安装。格式 1 已有的标记保留，格式 2 新增：

| 标记 | 来源 |
| --- | --- |
| `format.2` | `format` 为 2 |
| `platform.<n>` | `requires.platform` |
| `backend.wasm.abi<n>` | `backend.runtime` 与 `backend.abi` |
| `storage.shared` / `storage.public` / `storage.account` | 后端声明的存储范围 |
| `access.permissions` / `access.default_grant` | 声明了应用内权限 / 默认授予 |
| `surface.standalone` / `surface.public` / `surface.public.session` | 界面入口 |
| `uses.<能力名>` / `provides.<扩展点>` | `platform` |
| `mcp.tools` / `mcp.declarative` / `mcp.remote` / `mcp.resources` / `mcp.prompts` / `skills` | AI 组件 |
