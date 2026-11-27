---
name: article-writing
description: 按修订号安全地起草、整理、归类并发布文章草稿，保护文件引用与发布快照边界。
tools:
  - list_articles
  - get_article
  - create_article
  - save_article
  - article_action
  - save_article_taxonomy
  - list_article_files
---

# 文章写作与整理工作流

## 原则

1. **草稿与发布分离**：常规写作与改稿一律使用 `action: "save"`，只有用户明确要求发布或更新发布时才使用 `action: "publish"`。
2. **公开发布确认**：将 `visibility` 设为 `public` 并发布前，向用户确认正文、封面及全部附件都将允许匿名访问。
3. **修订号保护**：修改文章或分类标签前先读取最新 `revision`，收到冲突错误时重新读取并合并，不盲目覆盖。
4. **保留文件引用**：更新正文时保留所有既有的 `article-file:<id>` 引用及尺寸/排版参数，避免无意解除文件引用。

## 常用步骤

1. 调用 `list_articles` 查看已有文章、三级分类与标签。
2. 需要补充分类或标签时，调用 `save_article_taxonomy`（分类最多三级，不可循环）。
3. 新建草稿调用 `create_article`（`action: "save"`）；编辑已有文章先调用 `get_article`，再按当前 `revision` 调用 `save_article`。
4. 需要撤回、移入回收站、恢复或永久删除时，调用 `article_action`；永久删除仅对回收站中的文章生效且不可恢复，执行前须经用户确认。
