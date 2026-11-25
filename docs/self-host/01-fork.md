# 自建商店

商店是纯静态站点，Fork 本仓库即可为团队搭一个自己的商店，例如只收录内部应用的私有商店。

## 1. Fork 并修改配置

编辑仓库根目录的 `store.config.json`：

```json
{
  "id": "team-store",
  "name": "团队应用商店",
  "description": "收录团队内部使用的应用。",
  "homepage": "https://<owner>.github.io/<repo>/",
  "repository": "https://github.com/<owner>/<repo>",
  "access": "public",
  "keys": []
}
```

`id` 会写进每个版本的签名内容，**发布后不要再修改**。

## 2. 生成签名密钥

```sh
go run ./cmd/appcheck keygen
```

命令输出私钥（标准输出）、公钥和指纹（标准错误）：

- 把公钥 JSON 加进 `store.config.json` 的 `keys`；
- 在仓库的 **Settings → Environments** 新建环境 `store-publish`，限制只允许 `main` 分支部署，并把私钥保存为环境 Secret `DESK_STORE_SIGNING_KEY`；
- 把指纹公布在团队文档里，管理员添加商店源时用它核对。

私钥不要提交到仓库，也不要放进其他环境。

## 3. 启用 GitHub Pages

在 **Settings → Pages** 中把来源设为 **GitHub Actions**。之后每次推送到 `main`，`Publish` 工作流都会：

1. 在无密钥的作业中校验全部应用、生成静态数据并确定性打包新版本；
2. 在 `store-publish` 环境中只对生成的版本记录签名，为新版本创建 GitHub Release（标签为 `<slug>@<version>`）并上传安装包；
3. 构建网站并部署到 Pages。

已发布的版本记录从线上站点读取，并与新版本合并，所以历史版本和它们的签名会一直保留。

## 4. 轮换密钥

1. 生成新密钥，把新公钥**追加**到 `keys`，替换环境 Secret；
2. 新版本会用新密钥签名，旧版本保留旧签名，两把公钥同时公布；
3. 通知管理员在系统中重新核对商店源的指纹。

确认所有系统都已更新后，才能移除旧公钥；移除后，用旧密钥签名的版本将无法校验。

## 私有商店

`access` 设为 `token` 表示访问需要令牌。GitHub Pages 本身不支持访问控制，需要私有商店时，把 `dist/site` 部署到能校验 `Authorization: Bearer <令牌>` 的静态服务（例如带鉴权的反向代理）后面，并把安装包也放在同一服务下（构建时不传 `-download-base`，安装包随站点输出到 `api/v1/packages/`）。
