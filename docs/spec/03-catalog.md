# 商店数据格式补充（草案）

在现有[静态数据格式](../self-host/02-data-format.md)（`api/v1/`）上增加字段与文件，用于展示格式 2 的应用、判断兼容性、核对数据库迁移与发布安全通告。新增字段都是可选的：只认识旧字段的客户端忽略它们，仍按现有规则工作；数据目录保持 `api/v1/`。

## 1. store.json

| 字段 | 说明 |
| --- | --- |
| `formats` | 加入 `2`，例如 `[1, 2]` |
| `advisories` | 安全通告文件的相对地址，默认 `advisories.json`；不提供通告的商店省略 |

## 2. index.json 与 apps/{slug}.json

索引条目新增：

| 字段 | 说明 |
| --- | --- |
| `components` | `["ui", "backend", "mcp", "skills"]` 的子集，按[应用包格式 2](01-package-v2.md#1-组件模型)判定 |
| `requires` | `{ "platform": 1 }`，最新版本的要求 |

详情的每个版本新增：

| 字段 | 说明 |
| --- | --- |
| `components` / `requires` | 该版本的组件与要求 |
| `capabilities` | 该版本的能力标记（[格式 2 第 10 节](01-package-v2.md#10-能力标记)）；索引中的 `capabilities` 为最新版本的值 |
| `migrations` | 迁移摘要，见第 3 节 |
| `permissions` | 权限摘要，在现有字段上扩展，见第 4 节 |

客户端判断能否安装：`format` 在自己支持的格式内、`requires.platform` 不高于自己支持的平台大版本、`capabilities` 都在自己支持的名单内。任一不满足时显示“当前系统不支持”，并列出缺少的项。

## 3. 迁移摘要

```json
{
  "migrations": {
    "shared": [{ "id": "0001_init", "sha256": "…" }, { "id": "0002_add_cover", "sha256": "…" }],
    "public": [{ "id": "0001_init", "sha256": "…" }]
  }
}
```

- 列出该版本包内全部迁移文件（按编号），没有后端或没有迁移的版本省略。
- 商店 CI 用它核对“已发布的迁移不可修改”：新版本中与上一个已发布版本同名的项摘要必须一致，新增项只能追加在末尾。
- 客户端在更新前可以先用它与本机执行记录比较，提前提示“已发布的迁移被修改”，不必下载安装包。

## 4. 权限摘要扩展

`permissions` 新增以下字段（现有字段不变）：

| 字段 | 说明 |
| --- | --- |
| `access` | `{ "permissions": [{ "name", "title" }], "defaultGrant": "none" }` |
| `surfaces` | `{ "standalone": true, "public": { "alias": "/articles", "session": "optional" } }` |
| `backend` | `{ "routes": [{ "path", "methods", "visibility", "audit"?: { "mode"?, "action"?, "label"? } }], "storage": { "shared": true, "public": true, "account": false }, "http": ["api.example.com"], "hooks": ["payment"], "schedules": ["daily-digest"], "config": [{ "key", "title", "secret" }] }` |
| `platform` | `{ "uses": [...], "provides": [...] }` |
| `mcp` | `{ "tools": [{ "name", "title", "description", "readOnly", "destructive", "kind": "backend | declarative | remote" }], "resources": [...], "prompts": [...], "remote": { "proxy", "pinnedTools" } }` |
| `skills` | `[{ "name", "description", "tools": [...], "files": [{ "path", "size", "content" }] }]`（`tools`、`files` 可选，`files` 含 `SKILL.md` 与 `references/*` 纯文本内容） |

商店网站与目标系统都用它展示安装前的权限说明。CI 在 Pull Request 摘要中列出与上一个已发布版本相比**新增**的路由、存储范围、外部主机、公开入口、应用内权限、工具（尤其是 `destructive`）与技能，评审时重点检查；目标系统在更新确认中同样高亮新增项。

## 5. 安全通告

`advisories.json`：

```json
{
  "schema": 1,
  "generatedAt": "2026-11-26T00:00:00Z",
  "advisories": [
    {
      "id": "DS-2026-0001",
      "slug": "example-app",
      "versions": "<1.2.3",
      "severity": "high",
      "title": "公开接口可读取未发布内容",
      "description": "Markdown 说明",
      "fixedIn": "1.2.3",
      "action": "update"
    }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `versions` | 受影响版本，semver 范围（`<1.2.3`、`>=1.0.0 <1.2.3`、`=1.1.0`） |
| `severity` | `low`、`medium`、`high`、`critical` |
| `action` | `update`（建议更新到 `fixedIn`）或 `disable`（建议停用，通常没有修复版本时） |

- 签名：同目录下的 `advisories.json.sig` 为 Ed25519 签名（base64），签名内容为 `advisories.json` 的原始字节，使用商店已公布的密钥之一，第一行写 `keyId:<id>`，第二行为签名值。客户端只接受已固定公钥的有效签名。
- 客户端在检查更新时一并读取；本机已安装的受影响版本在应用管理中醒目提示，`critical` 且 `action` 为 `disable` 时提示管理员停用。客户端不自动停用或更新。
- 通告由商店维护者通过 Pull Request 修改 `advisories/` 下的源文件发布，与应用发布使用同一签名流程。

## 6. 商店侧需要实现的校验（appcheck 与 CI）

| 校验 | 内容 |
| --- | --- |
| 清单 | 格式 2 全部字段与上限；`format` 与新增字段一致；`access.permissions` 与 `permissions`（`proxy.*`）不混用 |
| 构建 | `build.json` 的工具链在登记名单内；构建可复现（构建两次摘要一致）；仓库中没有预编译的 `app.wasm` 与界面构建产物 |
| 后端 | 模块导入的宿主函数都有对应声明；导出了 `handle`；体积上限 |
| 迁移 | 文件名与编号规则、语句白名单；与上一个已发布版本比较（第 3 节） |
| AI 组件 | `input_schema` 子集与大小；声明式工具只引用已声明代理的路径与方法；`SKILL.md` 头部字段；技能引用的工具存在；不含脚本 |
| 摘要 | 生成 `components`、`requires`、`capabilities`、`migrations`、扩展后的 `permissions`；PR 摘要列出新增项 |
| 通告 | `advisories/` 源文件格式、版本范围语法；发布时生成并签名 `advisories.json` |
