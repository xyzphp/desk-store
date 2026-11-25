# 桌面卡片

声明 `desktop_widget: true` 的应用会在桌面右侧显示一张卡片。推荐同时声明 `widget`：卡片由系统用原生组件渲染接口数据，不执行包内脚本，也不嵌入页面。

```json
{
  "desktop_widget": true,
  "widget": {
    "title": "服务状态",
    "proxy": "status",
    "path": "/status.json",
    "refresh_seconds": 300,
    "metrics": [
      { "label": "CPU 使用率", "value_path": "cpu.used_percent" },
      { "label": "剩余额度", "value_path": "quota.used_percent", "invert": true, "reset_path": "quota.reset_at" }
    ]
  }
}
```

| 字段 | 规则 |
| --- | --- |
| `title` | 最多 64 个字符 |
| `proxy` | 已声明且有权限点的代理 |
| `path` | 该代理 `GET` 白名单内的路径 |
| `refresh_seconds` | 60–3600，默认 900 |
| `metrics` | 1–4 项；`value_path` 指向 0–100 的数值，`invert: true` 显示 `100 - 值`，`reset_path` 可选，显示重置时间 |

字段路径是点分的 JSON 对象字段（最多 8 段），不支持表达式，也不能使用 `__proto__`、`prototype`、`constructor`。标题与标签只作为纯文本显示。

## 切换账号

上游有多个账号时，可以声明 `account_selector`，卡片顶部显示账号标签：

```json
"account_selector": {
  "path": "/api/accounts",
  "items_path": "accounts",
  "id_path": "id",
  "label_path": "name",
  "default_path": "primary_account_id",
  "query_param": "account_id"
}
```

`path` 必须在同一代理的白名单内，且该代理 `pass_query: true`。卡片先读取账号列表（最多 64 个），再以 `widget.path?{query_param}={所选 ID}` 请求数据。

使用较新字段（如 `account_selector`）的应用需要较新的系统版本，商店会把它标记为能力要求，旧系统会显示“不支持”。

## 显示与刷新

是否显示卡片由每个用户在外观设置中决定。应用停用、卸载、撤销授权或锁屏后卡片自动移除；刷新失败时保留最近一次的数据并标注。
