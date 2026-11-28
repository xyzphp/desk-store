# AI 接口

目标系统提供脱敏托管的平台 AI 输出能力（模型查询、文本补全与图像生成）。应用无需、也不能自行接触模型供应商地址或 API Key，所有调用均受目标系统的账号模型授权、功能开关与单应用每日限额控制。

## 1. 声明能力

按实际需要声明一项或两项能力：

```json
{
  "platform": {
    "uses": ["ai.complete", "ai.image"]
  }
}
```

只要声明了 `ai.complete` 或 `ai.image` 中的任意一项，前端即可自动获得 `ai.models / list` 查询权限。

## 2. 查询可用模型（`ai.models`）

前端在展示模型下拉框或判断是否显示 AI / 生图入口前，应先向平台拉取当前账号实际有权使用的脱敏模型列表：

```js
const catalog = await invoke('platform', {
  capability: 'ai.models',
  action: 'list',
  payload: {},
});
```

返回结构：

```json
{
  "models": [
    { "id": "model-text", "name": "通用文本模型", "imageEnabled": false },
    { "id": "model-vision", "name": "多模态生图模型", "imageEnabled": true }
  ],
  "defaultModelId": "model-text",
  "textEnabled": true,
  "imageEnabled": true
}
```

- 仅返回当前登录账号已获授权的模型，不含供应商地址、密钥或未授权条目；
- 前端应据此决定文本补全或生图按钮是否可用，切勿硬编码模型名称。

## 3. 文本补全（`ai.complete`）

### 前端调用

```js
const result = await invoke('platform', {
  capability: 'ai.complete',
  action: 'complete',
  payload: {
    modelId: 'model-text',
    system: '你是一个严谨的文本校对助手。',
    messages: [{ role: 'user', content: '请润色下面这段说明。' }],
    maxOutput: 800,
    responseFormat: 'text',
  },
});
// result: { text, model, usage: { inputTokens, outputTokens } }
```

### 输入与行为约束

| 字段 | 规则 |
| --- | --- |
| `modelId` | 可选；省略时在当前账号可用范围内优先使用默认模型；传入无权模型返回 `403` |
| `system` | 可选系统提示词，≤ 8,000 字 |
| `messages` | 必填数组，最多 40 条、合计 ≤ 100,000 字；`role` 仅允许 `user` / `assistant`，且最后一条必须为 `user` |
| `maxOutput` | 可选最大输出长度 |
| `responseFormat` | `"text"`（默认）或 `"json"` |

### 后端调用差异

Go 后端可通过 `appkit.AIComplete(messages, options)` 调用目标系统默认文本模型：

- `public` 与 `hook` 无登录调用者入口**禁止调用**；
- 后端调用会阻塞当前请求并受 `backend.limits.timeout_ms` 约束，因此面向用户的交互式长文本生成建议放在前端调用。

## 4. 图像生成（`ai.image`）

**生图能力仅限前端页面调用**（后端 Wasm 调用将直接返回权限错误 `-2`）：

```js
const img = await invoke('platform', {
  capability: 'ai.image',
  action: 'generate',
  payload: {
    modelId: 'model-vision',
    prompt: '极简几何风格的蓝紫色应用图标概念草图',
    size: 'auto',
    quality: 'medium',
    destPath: '/data/shared/generated/cover.png',
  },
});
```

| 字段 | 规则 |
| --- | --- |
| `modelId` | 可选；校验当前账号权限与生图规则，缺省优先默认生图模型 |
| `prompt` | 必填，≤ 4,000 字 |
| `size` | `"auto"` 或 `宽x高`（宽高比限制在 `1:3` 至 `3:1`） |
| `quality` | `"auto"` / `"low"` / `"medium"` / `"high"` |
| `destPath` | 可选；传入时由宿主直接写入应用 `/data/...` 存储并返回 `{ path, mediaType, width, height, size }`，省略时返回 `{ dataBase64, ... }` |

## 5. 计量、限额与错误处理

- **应用级每日配额**：目标系统按应用独立统计每日调用次数与 Token 用量；管理员将某应用限额设为 `0` 时调用返回 `403`，达到当日上限返回 `429`。
- **界面容错建议**：遇到 `403` / `429` 或 `imageEnabled === false` 时，前端应给出清晰的中文状态提示，不要静默失败或无限重试。
