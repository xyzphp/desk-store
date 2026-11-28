# 部署与运维

Desk Store 由纯静态站点和签名 CLI 组成。团队 Fork 仓库并配置自有 Ed25519 签名密钥，即可搭建公开或带令牌鉴权的内部应用商店。

> **关键约束**：`store.config.json` 中的 `id` 会写入每个版本的签名内容，**首次发布后不可修改**；签名私钥严禁入库或暴露给无保护的 PR 工作流。

## 1. 修改 `store.config.json`

```json
{
  "id": "team-store",
  "name": "团队应用商店",
  "description": "团队内部应用分发商店。",
  "homepage": "https://store.example.com/",
  "repository": "https://github.com/<owner>/<repo>",
  "access": "public",
  "keys": []
}
```

`access` 设为 `"public"` 表示公开商店，设为 `"token"` 表示访问时需携带 `Authorization: Bearer <令牌>`。

## 2. 生成并托管签名密钥

```sh
go run ./cmd/appcheck keygen
```

- 将标准错误输出的公钥对象加入 `store.config.json` 的 `keys` 数组并提交；
- 在 GitHub 仓库 **Settings → Environments** 创建受保护环境 `store-publish`（仅允许 `main` 分支部署），将私钥存为环境 Secret `DESK_STORE_SIGNING_KEY`；
- 将公钥指纹公布在可信文档中，供管理员添加商店源时人工核对。

## 3. 启用自动发布（GitHub Pages）

在 **Settings → Pages** 中将来源设为 **GitHub Actions**。每次推送 `main` 后，`Publish` 工作流按最小权限分阶段执行：

1. **无密钥构建作业**：校验全部应用目录、执行可复现构建、打包新版本并合并线上历史版本元数据；
2. **受保护签名作业（`store-publish`）**：读取签名私钥签署新版本记录与 `advisories.json`，并上传安装包至 GitHub Release（标签 `<slug>@<version>`）；
3. **发布静态站**：构建 `web/` 并部署到 Pages。

## 4. 私有令牌商店部署

需要访问控制时，将 `access` 设为 `"token"`，构建时**不传 `-download-base`**（使安装包输出到 `api/v1/packages/`），并将 `dist/site/` 托管在带 Bearer 校验的静态服务器后：

```sh
go run ./cmd/appcheck build -out dist/public
go run ./cmd/appcheck sign -out dist/public
pnpm --dir web build
```

Nginx 示例配置：

```nginx
server {
  listen 443 ssl;
  server_name store.example.com;
  root /var/www/desk-store;

  location /api/v1/ {
    if ($http_authorization != "Bearer <替换为强随机令牌>") {
      return 401;
    }
    try_files $uri =404;
  }

  location / {
    try_files $uri /index.html;
  }
}
```

## 5. 密钥轮换与安全通告

- **平滑轮换密钥**：生成新密钥后，先把新公钥**追加**到 `keys` 并替换环境 Secret（保留旧公钥使历史版本可继续验签）；待全部客户端核对更新指纹后，再移除旧公钥。
- **发布安全通告**：通过 PR 更新 `advisories/` 源文件，合并后发布流水线会自动生成并签署 `api/v1/advisories.json` 与 `advisories.json.sig`，供客户端检查更新时向受影响版本告警。
