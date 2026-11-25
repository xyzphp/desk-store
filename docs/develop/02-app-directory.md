# 应用目录

每个应用是 `apps/` 下的一个目录，目录名等于应用标识：

```text
apps/<slug>/
├── package/        # 安装包内容，原样打成 ZIP（必需）
├── store.json      # 商店展示信息（必需）
├── README.md       # 详情页介绍（建议）
├── CHANGELOG.md    # 版本说明（建议）
├── screenshots/    # 截图（可选）
├── src/            # 需要构建的源码（可选，不进安装包）
└── LICENSE         # 应用自带的许可证全文（可选）
```

目录中不允许出现其他条目。以 `.` 开头的文件（如 `.DS_Store`）会被忽略。

## package/ 与安装包限制

`package/` 必须包含 `manifest.json` 和清单中声明的图标；使用 `entry` 时还需要入口 HTML。限制：

| 项 | 限制 |
| --- | --- |
| 文件数 | 含 `manifest.json` 不超过 32 个 |
| 大小 | 单文件 ≤ 1 MB，全部文件合计 ≤ 1 MB |
| 清单 | `manifest.json` ≤ 32 KB |
| 图标 | 包根目录的 SVG / PNG / JPEG / WebP，≤ 64 KB |
| 扩展名 | `.html .css .js .json .svg .png .jpg .jpeg .webp .woff2 .txt` |
| 路径 | 不能有符号链接、反斜杠、绝对路径或 `..` |

**首期不支持构建步骤**：CI 不会执行 `npm install` 之类的命令。使用 TypeScript 或打包工具时，把源码放在 `src/`，把构建结果放进 `package/` 一起提交。

## store.json

```json
{
  "summary": "一句话简介，1-80 个字符",
  "category": "tools",
  "tags": ["时间"],
  "authors": [{ "name": "作者", "url": "https://example.com" }],
  "license": "MIT",
  "homepage": "https://example.com/app",
  "repository": "https://github.com/example/app",
  "pricing": "free",
  "pricingUrl": "https://example.com/pricing",
  "screenshots": ["main.png"],
  "withdrawn": false,
  "yanked": []
}
```

| 字段 | 规则 |
| --- | --- |
| `summary` | 必需，1–80 个字符 |
| `category` | 必需，`productivity` `tools` `monitoring` `data` `communication` `developer` `other` 之一 |
| `tags` | 最多 8 个，每个 1–20 个字符 |
| `authors` | 必需，1–8 位，`url` 可选，必须是 https 地址 |
| `license` | 必需，开源许可证的 SPDX 标识：`MIT` `Apache-2.0` `BSD-2-Clause` `BSD-3-Clause` `ISC` `MPL-2.0` `LGPL-3.0-only` `LGPL-3.0-or-later` `GPL-3.0-only` `GPL-3.0-or-later` `AGPL-3.0-only` `AGPL-3.0-or-later` |
| `homepage` / `repository` | 可选，https 地址 |
| `pricing` | `free`（默认）、`freemium`（基础免费、增值服务收费）、`subscription`（需要订阅外部服务） |
| `pricingUrl` | `pricing` 不是 `free` 时必需，指向服务与价格说明 |
| `screenshots` | 最多 5 张，`screenshots/` 下的 PNG / JPEG / WebP 文件名，每张 ≤ 512 KB |
| `withdrawn` | 设为 `true` 下架应用 |
| `yanked` | 撤回的版本号列表 |

未知字段会被拒绝。

## README.md 与 CHANGELOG.md

- `README.md` 显示在详情页的「介绍」中，首个一级标题会被去掉。没有 README 时使用清单的 `description`。
- `CHANGELOG.md` 中 `## 1.2.0` 这样的小节会显示在对应版本下。
