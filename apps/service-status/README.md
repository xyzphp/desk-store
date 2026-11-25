# 服务状态

演示受控代理与桌面卡片：应用通过 `xyzos:proxy` 桥读取服务的 `/status.json`，桌面卡片显示其中的 CPU 与磁盘使用率。

## 安装时需要配置

- **服务地址**：默认是占位地址 `https://status.example.com`，安装确认时改成你的服务地址。
- **Bearer Token**：状态接口的访问令牌，由系统加密保存并在转发时注入，应用页面拿不到它。

## 接口格式

```json
{
  "cpu": { "used_percent": 37 },
  "disk": { "used_percent": 62 }
}
```

数值为 0-100 的百分比。
