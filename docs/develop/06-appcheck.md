# 校验与打包工具

`appcheck` 是本仓库自带的命令行工具，CI 用的也是它。在仓库根目录运行：

```sh
go run ./cmd/appcheck <命令>
```

| 命令 | 作用 |
| --- | --- |
| `check [目录或 ZIP ...]` | 校验应用目录、安装包内容目录或 ZIP；不带参数时校验 `apps/` 下全部 |
| `pack <应用目录> [-o 文件]` | 确定性打包为 ZIP |
| `summary <应用目录> [-base 地址]` | 输出权限摘要；带 `-base`（已发布数据的 `api/v1` 地址或目录）时列出与已发布版本相比的权限变化 |
| `build [-out dist/public]` | 生成商店静态数据 |
| `sign` / `verify` / `keygen` | 签名相关，见[自建商店](../self-host/01-fork.md)；`sign -dev-key 文件` 用本地联调密钥签名（文件不存在时生成），不能用于发布 |

应用带 `build.json`（格式 2 草案：`src/` 界面源码、`backend/` 后端源码）时，`check`、`pack`、`summary` 与 `build` 会先按 `build.json` 在临时目录中构建，再校验与打包，需要本机装有 Node 22 + pnpm 与 Go 1.26；本地工具链版本不一致时只提示，CI 中会失败。规则见 [应用包格式 2（草案）](../spec/01-package-v2.md#7-源码与构建)。

## 确定性打包

`pack` 与发布使用同一套规则：按路径排序、固定时间戳和权限、存储模式（不压缩）。同一份内容在任何机器上都得到字节相同的 ZIP，因此任何人都能从源码复现商店里的安装包并核对 SHA-256：

```sh
go run ./cmd/appcheck pack apps/world-clock -o world-clock.zip
shasum -a 256 world-clock.zip
```

## 本地联调

1. `appcheck pack` 生成 ZIP；
2. 在系统的「应用管理 → 安装应用」中上传，确认安装；
3. 修改后重新打包上传。同一个 slug 重新上传会替换旧版本，并回到待确认状态。

本地联调时不必修改版本号；提交 PR 前再按需要提升 `version`。

## 预览商店网站

```sh
git submodule update --init   # 网站使用子模块 desk-ui 中的组件库源码
pnpm install                  # 在仓库根目录执行
pnpm start  # 生成并签名 dist/public 下的商店数据，再启动网站：http://localhost:5180
# 只改网站代码时可以直接 pnpm dev；改了 apps/ 后重新运行 pnpm data
```

`pnpm data` 用本地联调密钥 `dist/dev-signing.key` 签名（首次运行时生成）。在本机系统中把 `http://127.0.0.1:5180/` 添加为商店源并核对指纹后，就能从本地商店安装应用；`dist/` 不进入 git，这把密钥也不能用于发布。

