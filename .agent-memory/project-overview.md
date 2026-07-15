# Project Overview

`aging-finance` is a mobile-first养老金融展示网站及单密码管理后台，面向云南养老金融生态圈。公开站点由 SQLite 内容、EJS 模板和源图片完整生成到 `public-generated/`；访客请求只读取静态文件，不在请求时查询 SQLite 或执行 EJS。

主要能力：

- 任意深度的父子页面树和父路径 URL。
- `home`、`card-list`、`content`、`link-list`、`image-only` 五种页面模板。
- 图片入口、文字入口、站内链接、安全 HTTP(S) 外链和后台排序。
- PNG/JPEG/WebP 上传、媒体替换、SHA-256 资源版本和完整静态重建。
- 单张图片页自动按 EXIF 方向旋转、最大 720px 等比缩放、去元数据并转 PNG。
- 单密码登录、签名 HttpOnly Cookie、API 鉴权、上传签名校验和生成目录安全边界。
- PM2 单进程部署，Nginx 对外路径为 `/af/`。

仓库使用 `develop` 作为当前开发分支，并同步到 GitHub `origin` 与 Gitee `gitee`。

Provenance: source_agent=Codex; updated=2026-07-15; commits=96d17fd,9d08bb7.
