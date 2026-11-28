# 数据与校验

商店对外仅提供纯静态 JSON、资源文件与签名文件，全部位于 `{商店地址}api/v1/` 下，相对路径均以该目录为基准解析。未来不兼容协议变更将使用新路径（如 `api/v2/`）。

格式 2 扩展字段补充定义见 [商店数据格式补充规范](../spec/03-catalog.md)。

## 1. 静态目录结构

```text
{商店地址}api/v1/
├── store.json              # 商店身份、访问模式、支持格式与 Ed25519 公钥
├── index.json              # 全量应用摘要（浏览与本地更新检查）
├── advisories.json         # 可选：安全通告清单
├── advisories.json.sig     # 可选：advisories.json 原始字节签名
├── apps/<slug>.json        # 单应用完整详情、权限摘要、迁移摘要与版本列表
├── assets/                 # 图标与截图资源
└── packages/               # 可选：自托管安装包 ZIP
```

## 2. 核心文件契约

### `store.json`

```json
{
  "schema": 1,
  "id": "desk-store",
  "name": "Desk Store",
  "description": "开源应用商店。",
  "homepage": "https://store.example.com/",
  "access": "public",
  "formats": [1, 2],
  "advisories": "advisories.json",
  "keys": [
    { "id": "3f2a9c01e4b8d721", "algorithm": "ed25519", "key": "<base64 公钥>" }
  ]
}
```

`keys[].id` 为公钥原始字节 SHA-256 的前 16 位小写十六进制字符。客户端添加商店源时须展示指纹供人工核对，并将公钥固定保存。

### `index.json`

包含每个应用的 `slug`、`name`、`summary`、`category`、`tags`、`icon`、`latestVersion`、`pricing`、`capabilities`、`components`、`requires`、`withdrawn`、`updatedAt`。客户端检查更新仅读取此文件并在本地比对版本，不向商店上报本机安装清单。

### `apps/{slug}.json`

包含应用展示字段与 `versions` 数组，每个版本对象包含：

| 字段 | 说明 |
| --- | --- |
| `version` / `format` | 语义化版本号与安装包格式（`1` / `2`） |
| `sha256` / `size` / `url` | ZIP 摘要（64 位小写十六进制）、字节数与下载地址 |
| `publishedAt` / `yanked` / `changelog` | 发布时间、撤回标记与版本说明 |
| `components` / `requires` / `capabilities` | 组件列表、平台大版本要求与能力标记 |
| `migrations` | 可选：按存储范围列出的历史迁移文件 `{ id, sha256 }` 列表 |
| `permissions` | 结构化权限摘要（页面来源、`gatewayApi`、`proxies`、`desktopWidget`，以及格式 2 的 `access`、`surfaces`、`backend`、`platform`、`mcp`、`skills`） |
| `signature` | `{ "keyId": "<公钥 id>", "value": "<base64 Ed25519 签名>" }` |

### `advisories.json` 与 `.sig`

通告记录含 `id`、`slug`、`versions`（SemVer 范围）、`severity`（`low`/`medium`/`high`/`critical`）、`title`、`description`、`fixedIn` 与 `action`（`update` / `disable`）。`advisories.json.sig` 为两行纯文本，对 `advisories.json` 原始字节签名：

```text
keyId:<16 位十六进制公钥 id>
<base64 Ed25519 签名>
```

## 3. 版本签名载荷与客户端校验步骤

每个版本的 `signature.value` 对以下 6 行 UTF-8 文本（**每行以 `\n` 结尾**）使用 Ed25519 私钥签名：

```text
desk-store-signature/v1
<商店 id>
<slug>
<version>
<sha256 小写十六进制>
<format>
```

目标系统安装或更新时须按顺序完成五步核验：

1. 校验 `format`、`requires.platform` 与全部 `capabilities` 均受当前系统支持；
2. 更新时比对 `migrations` 与本机已执行记录，发现历史迁移被改即拒绝；
3. 确认 `signature.keyId` 属于已固定公钥，并使用对应公钥验证签名载荷；
4. 下载安装包并核对字节 SHA-256 与签名记录完全一致；
5. 解压并按本机安全规则完整复检清单、扩展名、Wasm 导入表与迁移文件，再进入安装确认。
