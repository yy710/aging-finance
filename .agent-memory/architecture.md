# Architecture

## 发布链路

1. `admin/index.ejs`、`admin/app.js` 和 `admin/styles.css` 提供原生管理界面。
2. `server/auth.js` 负责单密码会话；`server/api.js` 暴露受保护的管理 API。
3. `server/content-service.js` 通过 `better-sqlite3` 读写页面、入口、媒体和站点设置。
4. `server/validation.js` 和 `server/sanitize.js` 校验结构、链接、状态与正文。
5. `server/generator.js` 读取发布内容，借助 `server/site-tree.js` 构造页面树和 URL，并用 `views/` 生成完整静态快照。
6. `server/app.js` 提供健康检查、后台/API 内部路由和 `public-generated/` 静态服务。

## 数据与文件边界

- `data/site.db`: SQLite 内容源；迁移由 `server/database.js` 管理。
- `public-assets/`: 固定源素材和 CSS/JS 模板。
- `uploads/`: 后台上传的原始媒体。
- `public-generated/`: 可重建发布产物，禁止手工编辑。
- `config/private.json`: 管理密码和 Cookie 密钥，必须保持 Git 忽略。

## 页面和入口

- 页面用 `parent_id` 形成任意深度树，URL 由整条父链生成。
- `image-only` 使用页面的 `title_image` 作为主体内容，模板为 `views/image-only.ejs`；仅额外渲染指向父页面的返回按钮，不渲染标题、背景、正文、入口或页脚。
- 入口只保存 `target_page_id` 或 `external_url`；后台下拉框中的 `external` 只是界面哨兵值，提交时转换回上述数据库字段。
- “仅显示本页面的下级页面”只筛选当前页面的直接子页面，不改变持久化数据；关闭后显示所有页面。
- `card-list` 的养老课堂布局为两列，并通过 `visual-card__title` 显示后台入口标题。
- 所有非首页模板都渲染 `partials/back-button.ejs`，其 `href` 来自数据库父页面 URL。
- 数据库版本 3 将空白或旧默认版权文字迁移为“中国工商银行云南省分行 · 养老金融与资产托管部”。

## 子路径

生产外部地址使用 `/af`。Nginx 删除该前缀后把请求代理到 Express 的内部 `/admin/`、`/api/`、`/health` 和静态路径；`PUBLIC_BASE_PATH=/af` 用于生成公开 URL、跳转和 Cookie Path。

Provenance: source_agent=Codex; updated=2026-07-15; refs=server/,admin/,views/,database_version=3.
