# 桌面卡片

声明 `desktop_widget: true` 的应用可在浏览器桌面卡片栏展示实时状态卡片，支持**声明式数据卡片（推荐）**与**自定义 iframe 卡片**两种模式。

> **首选声明式卡片**：数据来源于 JSON 接口时优先配置 `widget` 字段，由系统原生组件渲染，不执行包内脚本、开销极低，且自动适配系统卡片样式与深浅色主题。

## 1. 声明式数据卡片（`widget`）

```json
{
  "desktop_widget": true,
  "widget": {
    "title": "资源配额监控",
    "proxy": "status",
    "path": "/api/usage",
    "refresh_seconds": 300,
    "updated_path": "fetched_at",
    "metrics": [
      { "label": "CPU 使用率", "value_path": "cpu.used_percent" },
      {
        "label": "周期剩余额度",
        "value_path": "quota.used_percent",
        "reset_path": "quota.reset_at",
        "invert": true
      }
    ]
  }
}
```

### 字段参考

| 字段 | 必需 | 规则 |
| --- | --- | --- |
| `title` | 是 | 卡片标题，≤ 64 字符，纯文本渲染 |
| `proxy` | 是 | 已在 `proxies` 和 `permissions` 中声明的代理键名 |
| `path` | 是 | 命中该代理 `GET` 白名单的接口路径 |
| `refresh_seconds` | 否 | 自动刷新间隔，范围 `60–3600` 秒，默认 `900` |
| `updated_path` | 否 | 响应中更新时间字段的点分路径 |
| `metrics` | 是 | 1–4 项进度条指标：`label`、`value_path`（指向 0–100 数值）、可选 `invert: true`（显示 `100 - 值`）与可选 `reset_path` |

所有 `*_path` 仅支持最多 8 段的点分属性名，不支持表达式，并禁止 `__proto__`、`prototype`、`constructor`。

## 2. 多账号切换器（`account_selector`）

当上游接口支持按账号或实例切换指标时，可补充 `account_selector`，卡片顶部自动显示分段切换栏，每位用户独立保存当前选中项：

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

- `path` 须位于同一代理的 `GET` 白名单内，且该代理须声明 `"pass_query": true`；
- 系统先拉取列表（最多 64 项），再以 `widget.path?{query_param}={选中 ID}` 请求指标；
- 声明后自动生成 `widget.account_selector` 能力标记。

## 3. 自定义 iframe 卡片

仅声明 `"desktop_widget": true` 而省略 `widget` 时，目标系统在卡片容器中加载应用页面，并通过消息同步主题与紧凑态：

```js
const hostOrigin = new URL(document.baseURI).origin;

window.addEventListener('message', (event) => {
  if (event.source !== window.parent || event.origin !== hostOrigin) return;
  const data = event.data || {};
  if (data.type === 'xyzos:widget:theme') {
    document.documentElement.dataset.theme = data.theme; // 'light' | 'dark'
    document.body.classList.toggle('is-compact', Boolean(data.compact));
  }
});
```

## 4. 显示控制与容错

- 是否在桌面显示卡片由每位用户在外观设置中自主控制；
- 应用停用、卸载、撤权或锁屏后卡片立即清除；
- 刷新失败时声明式卡片保留最近一次有效数据并标注异常状态，支持手动重试。
