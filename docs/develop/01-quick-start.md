# 快速开始

这一页带你在十分钟内做出一个可以安装的应用，并提交到商店。

## 准备

- [Go](https://go.dev/dl/) 1.26 或更新版本，用来运行校验工具 `appcheck`。
- 一个可以安装应用的系统（例如 XYZOS），用来联调。
- 一个 GitHub 账号，用来提交 Pull Request。

## 1. 复制示例

Fork 并克隆本仓库，复制最小示例：

```sh
git clone https://github.com/<你的账号>/desk-store.git
cd desk-store
cp -R apps/hello-world apps/my-notes
```

目录名就是应用标识（slug），只能用 2–32 位小写字母、数字和连字符。

## 2. 修改清单

编辑 `apps/my-notes/package/manifest.json`：

```json
{
  "format": 1,
  "slug": "my-notes",
  "name": "我的笔记",
  "version": "1.0.0",
  "description": "在窗口里记下临时笔记。",
  "entry": "index.html",
  "icon": "icon.svg"
}
```

`slug` 必须与目录名一致。字段说明见[清单参考](03-manifest.md)。

## 3. 编写页面

`package/` 下的文件会原样打进安装包。页面是普通的 HTML / CSS / JS，用相对路径引用资源：

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="css/app.css">
</head>
<body>
  <textarea id="note" aria-label="笔记"></textarea>
  <script src="js/app.js"></script>
</body>
</html>
```

页面运行在沙箱里：没有 Cookie、不能用 `localStorage`、不能直接请求网络。需要外部数据时，先在清单里声明代理，再通过桥接消息请求，见[沙箱与桥接](04-bridge.md)。

## 4. 填写商店信息

编辑 `apps/my-notes/store.json` 和 `README.md`，它们只在商店展示，不进安装包：

```json
{
  "summary": "在窗口里记下临时笔记",
  "category": "productivity",
  "authors": [{ "name": "你的名字", "url": "https://github.com/<你的账号>" }],
  "license": "MIT"
}
```

字段说明见[应用目录](02-app-directory.md)。

## 5. 校验与联调

```sh
go run ./cmd/appcheck check apps/my-notes
go run ./cmd/appcheck pack apps/my-notes -o my-notes.zip
```

把 `my-notes.zip` 在系统的「应用管理 → 安装应用」中上传，确认安装后打开测试。

## 6. 提交

```sh
git checkout -b add-my-notes
git add apps/my-notes
git commit -m "Add my-notes"
git push origin add-my-notes
```

然后在 GitHub 上创建 Pull Request。评审规则见[提交与评审](../site/03-submit.md)。
