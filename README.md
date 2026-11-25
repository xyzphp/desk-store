# Desk Store

[![Check](https://github.com/xyzphp/desk-store/actions/workflows/check.yml/badge.svg)](https://github.com/xyzphp/desk-store/actions/workflows/check.yml)
[![Publish](https://github.com/xyzphp/desk-store/actions/workflows/publish.yml/badge.svg)](https://github.com/xyzphp/desk-store/actions/workflows/publish.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

面向浏览器桌面系统（例如 XYZOS）的开源应用商店。应用以源码形式通过 Pull Request 提交，由 CI 校验、确定性打包并签名；商店网站与数据全部是静态文件，部署在 GitHub Pages。

An open-source app store for browser desktops. Apps are submitted as source code through pull requests; CI validates, packs them deterministically and signs every release. The website and its data are static files served from GitHub Pages.

**商店网站 / Website：<https://xyzphp.github.io/desk-store/>**

## 特点

- **源码即应用**：每个应用是 `apps/<slug>/` 下的一个目录，评审看的就是源码与版本差异；不接受上传的安装包。
- **可复现的安装包**：固定顺序、时间戳与存储方式打包，同一提交在任何机器上打出字节相同的 ZIP。
- **签名发布**：每个版本记录用 Ed25519 签名，系统安装前校验签名与 SHA-256，再完整校验安装包。
- **权限透明**：PR 检查与详情页都会列出应用访问的外部服务与系统接口，更新时列出权限变化。
- **静态、可自建**：没有服务器和数据库。Fork 仓库、配置签名密钥即可搭建团队自己的商店。

## 仓库结构

| 目录 | 内容 |
| --- | --- |
| `apps/` | 应用源码，一个应用一个目录 |
| `pkg/appspec/` | 安装包格式、清单校验、权限摘要、签名与静态数据格式（Go） |
| `cmd/appcheck/` | 校验、打包、生成数据与签名的命令行工具 |
| `internal/build/` | 从 `apps/` 生成商店静态数据 |
| `web/` | 商店网站（React + [`@xyzos/desk-ui`](https://github.com/xyzphp/desk-ui)） |
| `docs/` | 站点文档、应用开发文档与自建文档，网站构建时一并发布 |

## 开发应用

从[快速开始](docs/develop/01-quick-start.md)读起：

```sh
cp -R apps/hello-world apps/my-app        # 改 slug、名称与图标
go run ./cmd/appcheck check apps/my-app   # 校验
go run ./cmd/appcheck pack apps/my-app    # 打包后在自己的系统中手动安装测试
```

然后提交 Pull Request，规则见[提交与评审](docs/site/03-submit.md)。

## 本地预览网站

需要 Go 1.26+、Node 22+ 与 pnpm：

```sh
cd web
pnpm install
pnpm start   # 生成 ../dist/public 下的商店数据并启动网站：http://localhost:5180
# 只改网站代码时可以直接 pnpm dev；改了 apps/ 后重新运行 pnpm data
```

## 在系统中使用

管理员在「应用管理 → 应用商店 → 商店源」中添加商店地址，并核对签名公钥指纹；之后即可搜索、安装和更新应用。见[在系统中安装应用](docs/site/02-install-in-xyzos.md)。对接的数据格式见[静态数据格式](docs/self-host/02-data-format.md)。

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证

商店代码与文档使用 [MIT](LICENSE)。每个应用在自己的 `store.json` 中声明开源许可证。
