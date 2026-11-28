# 文件与媒体

目标系统通过一组受控平台能力为应用提供文件选取、保存、引用保护、图片安全清洗与大文件流式直传，既满足富媒体业务需求，又确保应用无法越权遍历用户文件目录。

## 1. 能力声明与职责划分

```json
{
  "platform": {
    "uses": ["files.pick", "files.save", "files.reference", "image.sanitize"]
  }
}
```

| 能力 | 典型用途 | 适用端 |
| --- | --- | --- |
| `files.pick` | 唤起系统文件选择框，让用户显式挑选单个文件授权给本应用读取 | 前端 |
| `files.save` | 将新生成或上传的文件保存到调用者本人的文件管理根目录 | 前端 / 后端 |
| `files.reference` | 登记/解除应用对用户文件的引用，防止被误删，并支持受控读取与流式输出 | 前端 / 后端 |
| `image.sanitize` | 严格校验 PNG / JPEG 并重新编码剥离元数据与尾部恶意字节 | 前端 / 后端 |

## 2. 选取与保存用户文件

### `files.pick`（一次性读取令牌）

前端调用 `{ capability: "files.pick", action: "pick" }`：

- 用户取消时返回 `null`；
- 确认后返回 `{ fileId, name, mediaType, size, url, expiresAt }`；
- `url` 绑定当前会话、应用与目标文件，**一次性有效**且在 `expiresAt`（毫秒时间戳）前过期；页面直接 `fetch(url)` 读取，无需 Cookie。

### `files.save`（保存到用户文件管理）

- **前端调用**：`{ capability: "files.save", action: "save", payload: { name, file? | dataBase64?, refKey? } }`（支持 `Blob` / `File`，上限 20 MB，重名自动改名为 `名称 (2).ext`）；
- **后端调用**：`appkit.FileSave(name, sourcePath, data, refKey)`（仅登录调用者可用，`public` 入口禁止；`data_b64` 受 64 KB 载荷限制，较大文件先写入应用 `/data` 目录再传 `source_path`）；
- **自动校验与登记**：要求调用者拥有文件管理权限，遵循文件管理配额与图片清洗规则；若 `refKey` 非空且声明了 `files.reference`，宿主自动同时登记引用。返回 `{ fileId, name, mediaType, size, width?, height?, refKey? }`。

## 3. 文件引用保护与受控读取（`files.reference`）

为了避免用户误删仍被应用引用的封面、附件或素材，应用可登记文件引用：

- **管理引用**（需登录调用者）：
  - `files.reference / add`：`{ fileId: "file:<id>", refKey?: string }`；
  - `files.reference / remove`：`{ fileId: "file:<id>", refKey?: string }`；
  - `files.reference / list`：查询本应用当前登记的引用列表；
  - 被引用的文件在文件管理中会被阻止回收或删除；当应用被卸载时，宿主自动释放全部引用。
- **后端读取引用文件**（任意入口可用，含 `public` / `schedule` / `hook`）：
  - 小文件（≤ 4 MB）或仅查元信息：调用 `appkit.FileReferenceRead(fileID, metaOnly)`，返回 `{ file_id, name, media_type, size, width, height, updated_at, data_b64? }`；
  - 大文件或直接响应下载：使用 `c.SendUserFile(200, "file:<id>", inline)`，由目标系统从底层存储（本地或对象存储）直接流式输出，不受 1 MB 响应体限制；
  - **访问控制责任**：只要任一账号为本应用登记了引用，后端即可读取；具体谁能看到该文件（如是否已公开发布）须由应用后端按自身业务状态严格校验；当所有引用均被解除后，读取会返回 404。

## 4. 图片安全清洗（`image.sanitize`）

处理用户上传或外部拉取的图片时，应通过平台清洗能力剔除 EXIF 与潜在畸形字节：

- **仅接受 PNG / JPEG**，重新编码输出指定格式（`png` / `jpeg`）与质量（`quality`）；
- 传入 `destPath`（位于应用 `/data/...` 存储内）时，由宿主受配额约束落盘并返回 `{ path, mediaType, width, height, size, sha256 }`；
- 未传 `destPath` 时返回清洗后的 `dataBase64`；
- `public` 入口禁止调用。

## 5. 应用隔离存储的大文件直传

对于存放在应用自身 `/data/shared`、`/data/public`、`/data/me` 的大文件，应避开 1 MB 常规 JSON 信封限制：

1. **上传**：前端调用 `__xyzos: 1` 的 `backendUpload`（上限 50 MB），宿主校验配额后先写入 `/data/<scope>/.uploads/<id>`，再把元数据 JSON 交给 `POST` 路由；后端通过 `c.ParseUpload()` 获取路径并移动到目标位置（若路由返回 `status >= 400`，宿主自动删除临时文件）。
2. **下载**：后端在响应信封设置 `send_file`（调用 `c.SendFile(200, "/data/...", inline)`），宿主校验路径与符号链接后直接流式输出并附加 `X-Content-Type-Options: nosniff` 与安全 `Content-Disposition`。
