# 静态数据格式

商店对外只提供静态文件，任何系统都可以按这个格式对接。所有文件位于 `{商店地址}api/v1/` 下，文件中的相对地址相对于这个目录解析。当前数据格式版本为 `1`，不兼容的变化会使用新的目录（如 `api/v2/`）。

## store.json

```json
{
  "schema": 1,
  "id": "desk-store",
  "name": "Desk Store",
  "description": "…",
  "homepage": "https://xyzphp.github.io/desk-store/",
  "access": "public",
  "formats": [1],
  "keys": [{ "id": "3f2a…", "algorithm": "ed25519", "key": "<base64 公钥>" }]
}
```

`access` 为 `token` 时，客户端在请求中带 `Authorization: Bearer <令牌>`。`keys[].id` 是公钥 SHA-256 的前 16 个十六进制字符；客户端添加商店时应展示公钥指纹供人工核对，并固定保存公钥。

## index.json

全部应用的摘要：`slug`、`name`、`summary`、`category`、`tags`、`icon`、`latestVersion`、`pricing`、`capabilities`、`withdrawn`、`updatedAt`。客户端检查更新时只需读取这个文件，在本地比较版本，不需要把本机安装清单发给商店。

## apps/{slug}.json

应用详情：展示信息、作者、许可证、源码地址、截图，以及 `versions` 列表。每个版本包含：

| 字段 | 说明 |
| --- | --- |
| `version` / `format` | 版本号与包格式 |
| `sha256` / `size` | 安装包摘要与字节数 |
| `url` | 下载地址，可以是相对地址或 GitHub Release 地址 |
| `publishedAt` / `yanked` / `changelog` | 发布时间、是否撤回、版本说明 |
| `permissions` | 权限摘要：页面来源、`gatewayApi`、代理列表、桌面卡片与能力标记 |
| `signature` | `{ "keyId": "…", "value": "<base64>" }` |

## 格式 2 与安全通告（草案）

索引与详情中的 `components`、`requires`、版本的 `capabilities`、`migrations` 与扩展后的 `permissions`，以及签名的 `advisories.json`，见 [商店数据格式补充（草案）](../spec/03-catalog.md)。只认识本页字段的客户端可以忽略它们。

## 签名内容

签名是 Ed25519，对以下文本（每行以 `\n` 结尾）签名：

```text
desk-store-signature/v1
<商店 id>
<slug>
<version>
<sha256 小写十六进制>
<format>
```

客户端安装时应依次校验：签名公钥在已固定的列表中、签名有效、下载内容的 SHA-256 与记录一致；然后仍按自身规则完整校验安装包。安装包所在的位置（例如 Release 下载域名）不需要可信，完整性由签名保证。
