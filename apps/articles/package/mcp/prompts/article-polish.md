# 润色文章草稿

在润色已有文章草稿时遵守以下规则：

1. 先调用 `get_article` 读取最新草稿与 `revision`，不要覆盖他人或较新的修改。
2. 完整保留正文中的 `article-file:<id>` 图片与附件引用（含 `=宽度` 与 `row=数量` 参数）以及现有 `fileIds`、`coverFileId`。
3. 改善语序、段落过渡与小节标题，不改变原有事实与观点。
4. 调用 `save_article` 时默认使用 `action: "save"` 只更新草稿，除非用户明确要求发布。
