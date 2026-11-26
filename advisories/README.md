# 安全通告

每条通告一个 JSON 文件，文件名与编号一致（如 `DS-2026-0001.json`）。构建时汇总为 `api/v1/advisories.json`，发布时用商店密钥签名为 `advisories.json.sig`。格式与客户端行为见 [docs/spec/03-catalog.md](../docs/spec/03-catalog.md#5-安全通告)。

```json
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
```

`versions` 为空格分隔的条件（`<`、`<=`、`>`、`>=`、`=` 加版本号），全部满足即受影响；`action` 为 `update`（必须给出不在范围内的 `fixedIn`）或 `disable`。
