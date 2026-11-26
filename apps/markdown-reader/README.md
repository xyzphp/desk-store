# Markdown 阅读器

[应用包格式 2](../../docs/spec/01-package-v2.md) 的纯前端示例：没有后端、没有构建步骤，安装包里就是页面源码。它演示：

- **托管组件库**：页面 `<head>` 写 `<meta name="xyzos-desk-ui">`，目标系统注入 `react`、`react-dom/client` 与 `@xyzos/desk-ui` 的导入映射和样式表，页面直接 `import` 使用，不必把组件库打包进来；颜色随系统浅色 / 深色主题变化。
- **用…打开**（`platform.provides.open_with`）：文件管理中右键 `.md` / `.markdown` 文件选择“用 Markdown 阅读器 打开”，系统签发一次性读取地址并打开本应用窗口。
- **应用设置**（`platform.provides.settings`）：管理员在应用管理中设置正文字号、代码块是否换行与空白页提示，页面读取后生效。
- **平台接口 v1**（`platform.uses`）：`identity` 显示当前用户名，`files.pick` 打开系统文件选择窗口，`workspace.state` 记住上次打开的文件名，`notify` 与 `ui` 用于阅读提醒页。
- **应用内权限与页面可见范围**（`access`、`surfaces`）：`remind` 权限默认授予；`/remind/` 页面只对拥有该权限的成员开放，由系统在打开页面时检查，页面里的按钮只是界面提示。

页面经 `js/bridge.js` 与桌面壳通信（消息协议见[平台接口 v1](../../docs/spec/04-platform-v1.md)）。读取文件需要账号有文件管理权限；文件内容只在页面中渲染成文字元素，不作为 HTML 执行，链接显示为文字与地址。

只支持格式 1 的系统会把本应用标记为“当前系统不支持”。
