# 快速开始

本页介绍如何从零创建一个可通过校验与打包的应用包，并说明格式 1 与格式 2 的选型边界。

> **选型原则**：纯静态页面、声明式桌面卡片或轻量受控代理页面使用 **格式 1**；需要复用托管 `@xyzos/desk-ui`、Go Wasm 后端、隔离 SQLite 存储、平台接口 v1、MCP 工具或公开入口时使用 **格式 2**。

## 准备环境

- [Go](https://go.dev/dl/) `1.26` 或更新版本：运行校验与打包工具 `appcheck`，并编译格式 2 Wasm 后端；
- Node.js `22` + `pnpm`（开发需要构建前端的格式 2 应用或预览商店站点时使用）；
- 一套兼容 Desk Store 的目标系统用于本地实机联调；
- GitHub 账号，用于提交 Pull Request。

## 1. 创建应用目录

克隆仓库并在 `apps/` 下创建应用目录（目录名即 `slug`，限 2–32 位小写字母、数字与连字符，不以连字符开头或结尾）：

```sh
git clone https://github.com/<你的账号>/desk-store.git
cd desk-store
mkdir -p apps/my-app/package
```

## 2. 编写应用清单

创建 `apps/my-app/package/manifest.json`（格式 1 最小示例）：

```json
{
  "format": 1,
  "slug": "my-app",
  "name": "示例应用",
  "version": "1.0.0",
  "description": "一个运行在沙箱窗口中的静态示例应用。",
  "entry": "index.html",
  "icon": "icon.svg",
  "window": {
    "width": 720,
    "height": 520
  }
}
```

如需声明平台能力、后端路由、AI 工具或公开入口，将 `format` 设为 `2` 并添加对应字段，详见 [清单参考](03-manifest.md) 与 [能力总览](../platform/01-capabilities.md)。

## 3. 编写页面与图标

在 `apps/my-app/package/` 中放入 `icon.svg`（≤ 64 KB）与 `index.html`，所有资源使用相对路径引用：

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="css/app.css">
</head>
<body>
  <main id="app"></main>
  <script src="js/app.js"></script>
</body>
</html>
```

页面运行在不透明源沙箱中，与外部服务或宿主能力通信需通过消息桥接，见 [沙箱与桥接](04-bridge.md)。

## 4. 填写商店元数据

在应用根目录创建 `store.json`（仅用于商店展示，不进入安装包），并补充 `README.md`（写明应用自身的功能与配置说明）和 `CHANGELOG.md`：

```json
{
  "summary": "一句话说明应用核心用途",
  "category": "tools",
  "tags": ["工具"],
  "authors": [{ "name": "你的名字", "url": "https://github.com/<你的账号>" }],
  "license": "MIT"
}
```

## 5. 本地校验与联调

```sh
go run ./cmd/appcheck check apps/my-app
go run ./cmd/appcheck pack apps/my-app -o my-app.zip
go run ./cmd/appcheck summary apps/my-app
```

将 `my-app.zip` 上传到目标系统的「应用管理 → 安装应用」即可联调；也可以通过本地商店预览环境验证完整签名安装流程，见 [校验与打包](06-appcheck.md)。

## 6. 按需扩展格式 2 能力

| 扩展方向 | 关键配置 | 对应规范 |
| --- | --- | --- |
| 托管组件库与主题同步 | `<meta name="xyzos-desk-ui" content="1">` | [沙箱与桥接](04-bridge.md) |
| Wasm 后端与隔离 SQLite | `build.json` + `backend/` + `migrations/` | [后端开发](07-backend.md) |
| 文件、媒体、AI 与扩展点 | `platform.uses` + `platform.provides` | [能力总览](../platform/01-capabilities.md) |
| AI 工具与纯文本技能 | `mcp` + `skills` | [MCP 与技能](../platform/05-mcp-and-skills.md) |
| 独立页与公开站 SSR | `surfaces` + `/public/ssr` | [入口与公开页](../platform/06-surfaces-and-public.md) |

完成后创建分支提交 Pull Request，规范见 [提交与评审](../site/03-submit.md)。
