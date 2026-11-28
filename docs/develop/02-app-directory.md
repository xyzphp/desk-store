# 目录与限制

每个应用对应仓库 `apps/` 下的一个独立目录，目录名与 `package/manifest.json` 中的 `slug` 必须一致。

## 1. 标准目录结构

### 格式 1（静态单包）

```text
apps/<slug>/
├── package/            # 安装包内容，原样打包成 ZIP（必需）
│   ├── manifest.json   # 应用清单（必需）
│   ├── icon.svg        # 应用图标（必需）
│   ├── index.html      # 入口页（使用 entry 时必需）
│   └── css/ js/ ...    # 相对路径静态资源
├── store.json          # 商店展示元信息（必需，不进安装包）
├── README.md           # 应用功能与配置说明（建议）
├── CHANGELOG.md        # 版本更新日志（建议）
├── screenshots/        # 截图（可选）
├── src/                # 可选原始源码（不进安装包）
└── LICENSE             # 许可证全文（可选）
```

### 格式 2（源码构建 + 后端 + MCP + 技能）

```text
apps/<slug>/
├── build.json          # 含 src/ 或 backend/ 时必需
├── store.json          # 商店展示元信息（必需）
├── README.md           # 应用功能与配置说明（建议）
├── CHANGELOG.md        # 版本更新日志（建议）
├── LICENSE             # 许可证全文（可选）
├── screenshots/        # 截图（可选）
├── src/                # 可选：前端源码（含 pnpm-lock.yaml），CI 构建到 package/
├── backend/            # 可选：独立 Go 模块（含 go.mod / go.sum），CI 构建为 app.wasm
└── package/            # 无需构建的静态包文件（必需）
    ├── manifest.json
    ├── icon.svg
    ├── backend/
    │   └── migrations/
    │       ├── shared/0001_init.sql
    │       ├── public/0001_init.sql
    │       └── account/0001_init.sql
    ├── mcp/
    │   └── prompts/
    │       └── example.md
    └── skills/
        └── <skill-name>/
            ├── SKILL.md
            └── references/
```

根目录不允许存在规定以外的杂项文件；以 `.` 开头的隐藏文件会在打包时被忽略。

## 2. 安装包体积与扩展名上限

| 校验项 | 格式 1 | 格式 2 |
| --- | --- | --- |
| 解压后总大小（含 `manifest.json`） | ≤ 1 MB | ≤ 16 MB |
| ZIP 本体大小 | ≤ 2 MB | ≤ 18 MB |
| 文件总数（含 `manifest.json`） | ≤ 32 个 | ≤ 500 个 |
| `manifest.json` 大小 | ≤ 32 KB | ≤ 64 KB |
| 单文件上限 | ≤ 1 MB | ≤ 2 MB（`backend/app.wasm` 8 MB） |
| 图标文件 | 根目录 SVG / PNG / JPEG / WebP，≤ 64 KB | 同左 |
| 允许扩展名 | `.html .css .js .json .svg .png .jpg .jpeg .webp .woff2 .txt` | 以上全部，另加 `.md .sql .wasm .map` |
| 路径安全 | 禁止符号链接、反斜杠、绝对路径和 `..` | 同左 |

### 格式 2 扩展名位置限制

- `.wasm` 只能是 `package/backend/app.wasm`，且由 CI / `appcheck` 构建生成，**禁止预编译提交**；
- `.sql` 只能放在 `package/backend/migrations/<scope>/NNNN_<name>.sql`；
- `.md` 只能放在 `package/skills/` 或 `package/mcp/prompts/`；
- `package/skills/` 内仅允许 `.md`、`.txt`、`.json`，禁止脚本；
- `package/backend/` 内仅允许 `app.wasm` 与 `migrations/`。

## 3. `build.json` 构建声明

含 `src/` 或 `backend/` 源码时必须在根目录声明 `build.json`：

```json
{
  "ui": {
    "toolchain": "node@22",
    "command": "build",
    "output": "dist"
  },
  "backend": {
    "toolchain": "go@1.26",
    "abi": 1
  }
}
```

- 仅使用商店登记的固定工具链版本（当前为 `node@22`、`go@1.26`）；
- 前端在隔离环境中执行 `pnpm install --frozen-lockfile` 与 `pnpm run <command>` 并复制 `output`；
- 后端以固定参数编译为 WASI preview 1 reactor 模块，CI 连续构建两次比对摘要确保可复现。

## 4. `store.json` 字段规范

`store.json` 仅用于商店展示和索引构建，解析时拒绝未知字段：

| 字段 | 必需 | 规则 |
| --- | --- | --- |
| `summary` | 是 | 1–80 个字符的一句话简介 |
| `category` | 是 | `productivity`、`tools`、`monitoring`、`data`、`communication`、`developer`、`other` 之一 |
| `tags` | 否 | 最多 8 个，每个 1–20 个字符 |
| `authors` | 是 | 1–8 位作者，可选 `https://` `url` |
| `license` | 是 | 受支持的开源 SPDX 标识（如 `MIT`、`Apache-2.0`、`BSD-3-Clause`、`GPL-3.0-or-later` 等） |
| `homepage` / `repository` | 否 | `https://` 地址 |
| `pricing` | 否 | `free`（默认）、`freemium`、`subscription` |
| `pricingUrl` | 条件 | `pricing` 非 `free` 时必需 |
| `screenshots` | 否 | 最多 5 张，`screenshots/` 下 PNG / JPEG / WebP，单张 ≤ 512 KB |
| `withdrawn` / `yanked` | 否 | 下架布尔标记 / 撤回的版本号数组 |

## 5. `README.md` 与 `CHANGELOG.md`

- 应用自身的功能介绍、上游配置方法与使用说明统一写在各应用自己的 `README.md` 中，商店详情页自动渲染（首个 `#` 标题会被去除）；
- `CHANGELOG.md` 按 `## <版本号>` 分节，自动挂载到详情页版本时间线。
