# 云南养老金融生态圈静态网站

这是一个移动端优先的养老金融主题展示网站，并附带单密码管理后台。管理员在后台维护页面、Card、文字链接和图片；数据先写入 SQLite，再由 EJS 完整生成静态 HTML。公开访问只读取 `public-generated/`，不会在访客请求时查询 SQLite，也不会动态执行 EJS。

## 技术与运行环境

- Node.js 受支持的 LTS 版本；项目要求 `>= 22.17.0`
- Express 5
- better-sqlite3，启用 `foreign_keys` 和 WAL
- EJS，仅在发布阶段使用
- 原生 HTML、CSS、JavaScript
- multer 图片上传
- PM2 单进程 Fork 模式

当前项目已在以下环境实际运行：

- Node.js `v22.17.0`
- npm `10.9.2`

不使用 React、Vue、前端路由器、ORM 或动态公开页面渲染。

## 快速开始

### 1. 安装依赖

在项目根目录执行：

```bash
node --version
npm ci
```

如果不是从包含 `package-lock.json` 的完整项目安装，也可使用 `npm install`；正常部署优先使用可复现的 `npm ci`。

### 2. 准备私有配置

```bash
test -f config/private.json || cp config/private.example.json config/private.json
```

本次交付工作区的本地管理密码保存在 `config/private.json` 中，不在文档中公开。该文件已被 Git 忽略，新的代码检出不会携带它；如果是从 `private.example.json` 新建配置，请先自行设置本地密码。首次公网部署前必须同时更换管理密码和 Cookie 密钥，不能继续使用示例值或本地默认值。

建议生产配置：

```json
{
  "adminPassword": "替换为足够长且唯一的管理密码",
  "cookieSecret": "替换为至少32字符的随机密钥",
  "secureCookies": true
}
```

可用以下命令生成 Cookie 密钥：

```bash
openssl rand -base64 48
```

私有配置要求：

- `adminPassword` 至少 8 个字符，生产建议使用 20 个以上随机字符。
- `cookieSecret` 至少 32 个字符。
- HTTPS 生产环境将 `secureCookies` 设为 `true`。
- 将文件权限限制为服务账户可读，例如 `chmod 600 config/private.json`。
- 不要把 `config/private.json` 放进 `public-assets/` 或 `public-generated/`，也不要提交到代码仓库。

环境变量 `ADMIN_PASSWORD`、`COOKIE_SECRET` 和 `COOKIE_SECURE=true` 可以覆盖文件中的对应值；`PRIVATE_CONFIG_PATH` 可以指向项目外的私有 JSON 配置文件。

### 3. 初始化 SQLite 和示例数据

```bash
npm run init-db
```

默认数据库为 `data/site.db`。首次初始化会写入覆盖首页、二级、三级和四级页面的示例树，以及惠、医、养、乐、传各栏目的示例 Card。

常用初始化选项：

```bash
# 只建表，不写示例数据
npm run init-db -- --no-seed

# 保留数据库文件，清空页面和 Card 后重新写入种子
npm run init-db -- --replace-seed

# 删除现有数据库、WAL、SHM 后全新初始化；会丢失现有数据库内容
npm run init-db -- --reset

# 指定初始化数据库路径
npm run init-db -- --db /absolute/path/to/site.db
```

对已有生产数据不要使用 `--reset` 或 `--replace-seed`。

### 4. 生成公开静态网站

```bash
npm run generate
```

生成结果位于 `public-generated/`。生成器会先在同级临时目录完成全部页面和资源，全部成功后再进行目录级切换；如果生成失败，会回滚并保留当前版本。输出目录内的 `.aging-finance-generated` 是所有权标记，不要删除。

### 5. 启动

开发模式，修改服务端文件后自动重启：

```bash
npm run dev
```

普通启动：

```bash
npm start
```

默认监听 `127.0.0.1:3100`。本地地址：

- 公开首页：<http://127.0.0.1:3100/>
- 管理后台：<http://127.0.0.1:3100/admin/>
- 健康检查：<http://127.0.0.1:3100/health>

可以修改端口：

```bash
PORT=3200 npm start
```

服务启动时，如果数据库已有页面但 `public-generated/index.html` 不存在，会先自动完成一次静态生成。

### 6. 运行测试

```bash
npm test
```

快速检查健康状态：

```bash
curl http://127.0.0.1:3100/health
```

正常响应的 `status` 和 `database` 均为 `ok`。

## 管理后台使用

后台没有用户名，只验证一个管理密码。登录成功后使用签名的 HttpOnly Cookie，Cookie 设置 SameSite；生产 HTTPS 环境启用 Secure。所有管理 API 均要求登录。

### 页面维护

1. 打开 `/admin/` 并输入 `config/private.json` 中的管理密码。
2. 在左侧页面树选择现有页面，或点击 `+` 新建页面。
3. 设置标题、Slug、父页面、模板、装饰字、标题图片、背景主题、内容、顺序和状态。
4. 页面模板可选 `home`、`card-list`、`content`、`link-list`。
5. 背景可填写内置主题键 `home`、`hui`、`yi`、`yang`、`le`、`chuan`，也可填写已上传图片路径。
6. 点击“保存页面并重新生成”。保存成功后会自动完整发布静态网站。
7. 使用“查看生成页”核对结果。

同一父页面下的 Slug 必须唯一。发布页面必须有预渲染标题图片，并且其完整父级链都必须处于发布状态。系统拒绝父子循环，也拒绝直接删除仍有子页面或仍被其他 Card 链接的页面。修改 Slug 或父页面后，完整重建会清除旧静态路径。

### Card 和文字链接

1. 选择 Card 所属页面。
2. 点击“新增 Card”。
3. 选择 `image_card` 或 `text_link`。
4. 填写标题、说明、图片替代文字和排序。
5. 内部链接选择“内部目标页面”；外链填写完整的 `http://` 或 `https://` URL。存在内部目标时优先使用内部页面路径。
6. 保存后系统自动重新生成。
7. Card 列表中的上下箭头可以调整顺序；编辑或删除同样会触发完整生成。

发布的 `image_card` 必须提供一张已经包含可见标题/文案的图片；公开 HTML 不会回退为普通字体文字。发布的 Card 也必须设置有效的内部目标或 HTTP(S) 外链，且所属页面和内部目标都必须已发布。需要纯 HTML 文字的政策入口应选择 `text_link`。

### 上传和替换图片

- Card 编辑器中的“上传图片”支持 PNG、JPEG、WebP。
- 默认单文件上限为 5 MiB，可通过 `UPLOAD_MAX_BYTES` 调整；Nginx 示例允许 6 MiB 请求体。
- 服务端同时校验扩展名、声明 MIME 和真实文件签名，不接受 SVG 或可执行文件。
- 上传后图片保存在 `uploads/`，公开路径为 `/uploads/<安全文件名>`，并自动填入 Card 图片路径。
- 上传成功的路径会进入媒体库，也可以用于页面标题图片或背景图片字段。
- 媒体库的“替换同格式文件”会保留原公开路径，替换文件必须与原文件格式相同。
- 替换后会重新计算内容哈希并自动发布；管理员不需要手写版本号。

页面标题和设计稿中的特殊字体文字采用图片。新增自定义标题时，先上传正式标题 PNG，再将 `/uploads/...` 路径填入“标题图片路径”。文本标题仍保留，用于后台识别和无障碍替代文字。

### 手动完整重建

后台点击“重新生成全部网站”，或在项目根目录执行：

```bash
npm run generate
```

完整重建会同步更新首页、父页面、子页面、返回链接和内部 Card 链接，并清理已删除页面或旧 Slug 对应的 HTML。不要直接编辑 `public-generated/`，因为下一次生成会覆盖它。

`scripts/generate.js --output-dir` 只接受项目根目录内的专用生成目录。生成器会拒绝项目根、源码/数据目录、现有普通文件、没有所有权标记的既有目录，以及经过符号链接逃出项目的路径，避免误操作删除源码或其他数据。

## 静态发布架构

发布链路如下：

1. 管理后台经受保护的 `/api/` 调用修改数据。
2. 内容服务使用 prepared statements 和 transaction 写入 SQLite。
3. 生成器读取所有已发布页面和 Card，构造任意深度的父子树及 URL。
4. 生成前校验重复路径、孤立页面、父子循环、无效模板和无效内部链接。
5. 复制并哈希公开资源，在临时目录用 EJS 生成真实 `index.html`。
6. 完整成功后进行带备份回滚的目录级切换；失败则删除临时目录并恢复旧版本。
7. 访客由 Express 或 Nginx直接读取静态 HTML 和静态资源。

页面 URL 根据祖先 Slug 生成，例如：

```text
/le/
/le/new-oriental-tourism/
/hui/human-resources/national-policies/
```

每个 URL 对应一个目录下的 `index.html`。返回按钮既包含明确的父页面 `href`，也可在同站浏览时辅助使用浏览器历史，因此二维码或微信直接进入深层页面时仍可可靠返回。

管理操作先保存数据库再尝试发布。如果发布失败，API 会返回已保存实体和明确的 `PUBLICATION_FAILED` 状态；后台会立即重新同步并提示不要重复提交。此时数据库中的修改仍存在，但旧静态站保持可访问。修复资源或内容问题后执行完整重建即可。

目录切换使用“旧目录移至备份、暂存目录移至正式路径、成功后清理备份”的回滚流程，因此不会暴露半生成内容。两个重命名动作之间存在极短的路径交接窗口；PM2 的 15 秒优雅退出配置避免部署重启在交接中强杀进程。若业务要求跨发布的严格零 404，应在 Nginx 外层采用版本化 release 目录和原子符号链接指针。

## SHA-256 资源哈希与缓存

生成阶段会计算资源内容的 SHA-256，并取前 10 位写入 URL：

```text
/assets/images/home/logo.png?v=8f31c9a2ab
/uploads/example.png?v=71d604bf90
/assets/css/site.css?v=2c6db22988
```

规则如下：

- 清单写入 `public-generated/asset-manifest.json`。
- 文件内容不变，哈希和 URL 不变。
- 文件内容改变，哈希自动改变。
- 图片、JavaScript 等非 CSS 资源先计算哈希。
- `public-assets/css/site.css.ejs` 在发布时渲染为 CSS，其中每个本地 `url(...)` 背景图片都会写入真实图片哈希。
- 完成 CSS 内容后再计算 CSS 自身哈希，因此不会出现“CSS 有版本、CSS 内背景图片没有版本”的情况。
- EJS 中的 `asset()` 辅助函数负责生成带 `?v=<hash>` 的 URL；严格模式会拒绝未进入清单的本地资源。
- 富文本在发布边界会再次执行安全清洗；其中 `/assets/`、`/uploads/` 本地图片/文档链接会自动改写为当前哈希，缺失的受管资源会中止发布并保留旧站。
- 后台同路径替换图片后，重新生成的 HTML/CSS 自动引用新哈希。

缓存策略：

- HTML：`Cache-Control: no-cache`
- 带有效哈希参数的 `/assets/`、`/uploads/`、`/_assets/`：`public, max-age=31536000, immutable`
- `/admin/`：`no-store`
- `/api/`：`no-store`

Express 和 Nginx 都只对实际存在且请求带合法 `v` 哈希的成功资源响应启用 immutable；缺失资源、路径穿越请求和无版本资源不会获得一年缓存。

生产 Nginx 直接提供 `public-generated/assets/` 和 `public-generated/uploads/`。页面和 CSS 中应始终使用生成器输出的带哈希 URL，不要手工引用无版本资源。

Nginx 示例仍按 `v` 参数做条件缓存：只有 `v` 是 8 至 12 位十六进制哈希时才返回一年 immutable；缺少或非法 `v` 时返回 `no-cache`。示例在每个直接提供静态文件的 location 中显式重复 CSP、Referrer-Policy、`nosniff`、禁止 iframe、Permissions-Policy 和 HSTS，因为该 location 一旦定义自己的 `add_header Cache-Control`，通常就不会继承 server 级 `add_header`。

### 腾讯云 CDN 注意事项

腾讯云 CDN 的缓存键必须保留查询参数 `v`。不能配置为“忽略全部查询参数”，否则：

```text
/images/bg.png?v=旧哈希
/images/bg.png?v=新哈希
```

会被错误地视为同一个缓存对象。建议：

- 缓存键保留全部查询参数，或至少保留 `v`。
- `/admin/*` 和 `/api/*` 不走 CDN 缓存。
- HTML 遵循源站 `no-cache`，不要设置超长 CDN TTL。
- 资源遵循一年 immutable 缓存。
- 修改 CDN 缓存键规则后执行缓存刷新，再验证实际响应头和资源 URL。

## 配置与环境变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Express 监听地址 |
| `PORT` | `3100` | Express 端口 |
| `NODE_ENV` | `development` | 运行环境 |
| `DB_PATH` | `data/site.db` | 服务运行时 SQLite 路径 |
| `PRIVATE_CONFIG_PATH` | `config/private.json` | 私有配置路径 |
| `ADMIN_PASSWORD` | 私有配置值 | 覆盖管理密码 |
| `COOKIE_SECRET` | 私有配置值 | 覆盖 Cookie 签名密钥 |
| `COOKIE_SECURE` | 私有配置值 | `true` 时只通过 HTTPS 发送 Cookie |
| `SESSION_TTL_MS` | `28800000` | 管理会话有效期，默认 8 小时 |
| `UPLOAD_MAX_BYTES` | `5242880` | 单张上传图片上限，默认 5 MiB |
| `APP_ROOT` | `/www/wwwroot/yl.example.com` | PM2 配置中的项目绝对路径 |

`scripts/generate.js` 默认读取当前项目的 `data/site.db`。生产服务如果通过 `DB_PATH` 使用其他数据库，应由正在运行的服务调用后台“重新生成”，或保证独立生成命令使用对应项目根和数据库布局。

## PM2 单进程部署

SQLite、上传目录和静态目录替换都要求单写者。本项目必须使用 PM2 Fork 模式、`instances: 1`，不要改成 Cluster，也不要执行 `pm2 start ... -i max`。

假设项目部署在 `/www/wwwroot/yl.example.com`：

```bash
cd /www/wwwroot/yl.example.com
npm ci --omit=dev
test -f config/private.json || cp config/private.example.json config/private.json
chmod 600 config/private.json
```

编辑并更换生产密码、Cookie 密钥，将 `secureCookies` 设为 `true`，然后：

```bash
npm run init-db
npm run generate
mkdir -p logs
APP_ROOT=/www/wwwroot/yl.example.com pm2 start ecosystem.config.cjs
pm2 save
pm2 status
pm2 logs aging-finance
```

如果服务器尚未安装 PM2：

```bash
npm install --global pm2
```

执行 `pm2 startup`，再按它输出的命令配置开机启动，最后再次执行 `pm2 save`。

`ecosystem.config.cjs` 已固定：

- `exec_mode: fork`
- `instances: 1`
- `NODE_ENV=production`
- `HOST=127.0.0.1`
- `PORT=3100`
- `COOKIE_SECURE=true`
- `watch=false`
- `kill_timeout=15000`
- 自动重启
- 日志位于 `logs/pm2-out.log` 和 `logs/pm2-error.log`

服务监听 `SIGINT` 和 `SIGTERM`：先停止接收新连接，等待现有请求完成并关闭 SQLite；服务自身的兜底退出时间为 10 秒。PM2 的 `kill_timeout: 15000` 会在发送退出信号后等待最多 15 秒才强制终止，因此正常 `pm2 stop`、`pm2 restart` 和部署重启可以完成优雅关闭。不要用 `kill -9` 代替正常的 PM2 停止流程。

修改代码或配置后：

```bash
cd /www/wwwroot/yl.example.com
npm ci --omit=dev
npm run generate
pm2 restart aging-finance --update-env
```

## 宝塔、二级域名、Nginx 和 SSL

项目附带 [deploy/nginx-subdomain.conf.example](deploy/nginx-subdomain.conf.example)，示例域名为 `yl.example.com`，Node 监听 `127.0.0.1:3100`。

### 部署步骤

1. 在 DNS 控制台添加 `yl.example.com` 的 A/AAAA 记录并指向服务器。
2. 在宝塔“网站”中添加站点，域名填写 `yl.example.com`。
3. 将项目部署到 `/www/wwwroot/yl.example.com`，或把示例配置中的路径替换为实际绝对路径。
4. 按上一节安装依赖、配置私密文件、初始化数据库、生成静态站并启动 PM2。
5. 在宝塔站点“配置文件”中参考 `deploy/nginx-subdomain.conf.example` 配置 Nginx。
6. 确认站点根目录为 `/www/wwwroot/yl.example.com/public-generated`。
7. 创建位于生成目录之外的 ACME Webroot，避免完整重建删除续期文件：

```bash
mkdir -p /www/wwwroot/yl.example.com/.well-known/acme-challenge
```

8. 检查配置并重载 Nginx：

```bash
nginx -t
nginx -s reload
```

9. 在宝塔“SSL”中申请 Let's Encrypt 或安装正式证书，然后启用强制 HTTPS。
10. HTTPS 正常后确认 `COOKIE_SECURE=true` 或私有配置中的 `secureCookies: true`。
11. 云安全组和系统防火墙只开放 80/443；不要向公网开放 3100。

Nginx 分工：

- `/`、`/assets/`、`/uploads/`：直接读取 `public-generated/`
- `/api/`：反向代理到 Express
- `/admin/`：反向代理到 Express
- `/health`：反向代理到 Express
- `/.well-known/acme-challenge/`：从项目根目录下的专用 Webroot 直接提供，不经过 `public-generated/`

必须传递 `Host`、`X-Real-IP`、`X-Forwarded-For`、`X-Forwarded-Proto`。应用只信任 loopback 代理（`trust proxy = loopback`），因此 Nginx 应与 Node 位于同机并通过 `127.0.0.1` 转发。不要把 Express 改为无条件信任任意代理。

`/.well-known/acme-challenge/` 使用 `^~` 明确优先于通用点文件拒绝规则。宝塔如果生成单独的 HTTP 跳转 server，也必须在 `return 301 https://...` 之前保留同样的 ACME location，否则自动续期会被重定向或拒绝。该目录位于 `public-generated/` 之外，不会被静态站全量目录切换清理。

Nginx 示例为直接提供的 HTML、图片、CSS、JS、uploads 和 ACME 响应补充与 Express 一致的 CSP、Referrer-Policy、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY` 和 Permissions-Policy。它也发送一年期 `Strict-Transport-Security: max-age=31536000; includeSubDomains`；浏览器只会接受 HTTPS 响应中的 HSTS，HTTP 响应里的该头会被忽略。只有确认所有子域名都支持 HTTPS 后才应保留 `includeSubDomains`。

## 安全说明

- Express 默认只绑定 `127.0.0.1`；公网只暴露 Nginx 的 80/443。
- 管理 Cookie 为签名的 HttpOnly、SameSite Cookie；HTTPS 生产环境启用 Secure。
- 登录有内存级频率限制。
- 管理 API 全部要求登录，`/admin/` 和 `/api/` 禁止缓存。
- 内容 HTML 经过服务端清洗。
- 上传仅允许通过文件签名验证的 PNG/JPEG/WebP；拒绝 SVG、路径穿越和格式伪装。
- `data/`、`config/`、`views/`、`server/`、`resources/` 不位于公开静态根目录。
- 响应包含 CSP、`nosniff`、禁止 iframe、权限策略等安全头。
- Nginx 直接提供的静态响应显式重复相同安全头，避免 `add_header` 的 location 继承规则造成遗漏。
- HTTPS 响应包含一年期 HSTS；启用 `includeSubDomains` 前确认所有子域名均已支持 HTTPS。
- `config/private.json`、SQLite 和上传文件都应只允许部署账户和服务账户访问。

## 备份与恢复

必须一起备份：

- `data/site.db`
- `uploads/`
- `config/private.json`

`public-generated/` 可以通过数据库、模板和资源完整重建；代码和 `public-assets/` 应由代码仓库或发布包保存。若生产中直接替换过 `public-assets/` 的正式品牌素材，也要将它纳入发布包或额外备份。

### 一致性备份示例

为保证 SQLite WAL、上传文件和数据库记录一致，最简单可靠的方式是短暂停止单个 PM2 进程：

```bash
export APP_ROOT=/www/wwwroot/yl.example.com
export BACKUP_ROOT=/www/backup/aging-finance/$(date +%Y%m%d-%H%M%S)
umask 077
mkdir -p "$BACKUP_ROOT"

pm2 stop aging-finance
sqlite3 "$APP_ROOT/data/site.db" ".backup '$BACKUP_ROOT/site.db'"
tar -C "$APP_ROOT" -czf "$BACKUP_ROOT/uploads.tar.gz" uploads
cp "$APP_ROOT/config/private.json" "$BACKUP_ROOT/private.json"
pm2 start aging-finance
```

确认备份文件可读，并把备份目录存放在受权限控制、最好加密的异机位置。私有配置中含有管理凭据，不能放入公开对象存储。

### 恢复示例

恢复前先备份当前状态：

```bash
export APP_ROOT=/www/wwwroot/yl.example.com
export BACKUP_ROOT=/www/backup/aging-finance/20260714-120000

pm2 stop aging-finance
cp "$BACKUP_ROOT/site.db" "$APP_ROOT/data/site.db"
rm -f "$APP_ROOT/data/site.db-wal" "$APP_ROOT/data/site.db-shm"
rm -rf "$APP_ROOT/uploads"
tar -C "$APP_ROOT" -xzf "$BACKUP_ROOT/uploads.tar.gz"
install -m 600 "$BACKUP_ROOT/private.json" "$APP_ROOT/config/private.json"

cd "$APP_ROOT"
npm run generate
pm2 start aging-finance
curl http://127.0.0.1:3100/health
```

根据实际服务账户修正 `data/`、`uploads/` 和 `config/private.json` 的所有者。恢复后应登录后台、打开几个深层页面并检查图片哈希 URL。

## 目录结构

```text
aging-finance/
├── admin/                    # 原生 HTML/CSS/JS 管理后台
├── config/
│   ├── private.example.json # 私有配置示例
│   └── private.json         # 实际密码与 Cookie 密钥，禁止提交/公开
├── data/
│   └── site.db              # SQLite 数据库及运行时 WAL/SHM
├── deploy/
│   └── nginx-subdomain.conf.example
├── logs/                    # PM2 日志
├── public-assets/           # CSS 模板、JS、正式公开图片源
├── public-generated/        # 完整生成结果；不要手工编辑
├── resources/               # 原始设计图，仅用于设计参考和裁切
├── scripts/
│   ├── init-db.js           # 建表和种子数据
│   └── generate.js          # 静态完整生成
├── server/                  # Express、认证、数据库、生成器、上传与 API
├── uploads/                 # 后台上传的原始媒体
├── views/                   # EJS 页面模板和 partials
├── ecosystem.config.cjs     # PM2 单实例 Fork 配置
├── package.json
└── README.md
```

关键生成文件：

- `public-generated/index.html`：首页
- `public-generated/<ancestor>/<slug>/index.html`：子页面
- `public-generated/assets/`：生成后的 CSS、JS 和固定图片
- `public-generated/uploads/`：纳入发布快照的上传图片
- `public-generated/asset-manifest.json`：内容哈希清单
- `public-generated/.aging-finance-generated`：生成器所有权标记，用于阻止危险目录覆盖

## 正式品牌素材替换清单

当前项目已根据设计参考图裁切出可运行示例。以下素材不是正式原始品牌文件，上线前应由品牌方、合作机构或内容负责人提供高分辨率且获授权的版本：

- `public-assets/images/cards/` 下的合作企业、公证处、律所、保险公司和机构 Logo/Card；这些是从完整参考图中裁切的组合图片。
- `public-assets/images/products/finance-01.png` 至 `finance-03.png`；这些理财产品卡来自参考图裁切，应替换为正式产品图及经审核的产品文案。
- `public-assets/images/classroom/classroom-01.png` 至 `classroom-06.png`；这些课堂海报来自参考图裁切，应替换为完整清晰的正式海报。
- `public-assets/images/cards/hui-ministry-banner.png` 等机构横幅裁切。
- `public-assets/images/titles/generated-*.png` 是为无独立设计稿的示例详情页预渲染的占位标题，应替换为品牌方确认的正式书法/标题导出图。
- 首页 Logo、栏目入口、图片标题、书法装饰和底部场景目前来自已提供设计资源；如有品牌 VI 原文件，建议替换为正式导出版本。

替换同名 `public-assets/` 文件后执行：

```bash
npm run generate
```

内容哈希会自动变化，不需要修改 HTML 或版本号。也可以在后台上传新文件，再把页面标题或 Card 的图片路径改为新的 `/uploads/...`。

此外，上线前还应确认：

- 示例政策链接替换为准确、长期有效的正式政策详情 URL。
- 企业名称、产品名称、风险提示、版权文字和外链已通过业务及合规审核。
- 所有图片已取得公开展示授权，并提供准确的替代文字。

## 故障排查

### 启动提示缺少私有配置

如果看到 `Private configuration is missing`：

```bash
cp config/private.example.json config/private.json
chmod 600 config/private.json
```

然后填写合法的管理密码和至少 32 字符的 Cookie 密钥。

### `better-sqlite3` 安装或 ABI 错误

确认使用受支持的 Node LTS，并在该 Node 版本下重新执行：

```bash
node --version
npm ci
```

不要把其他 Node 主版本下生成的 `node_modules` 直接复制到服务器。

### 数据库不存在或没有页面

```bash
npm run init-db
npm run generate
```

不要在已有生产库上使用 `--reset`。

### 端口被占用

检查是否重复启动了 npm 和 PM2 进程。开发时可以临时更换端口：

```bash
PORT=3200 npm start
```

生产环境应只保留 PM2 的一个 `aging-finance` 实例，并让 Nginx 代理到相同端口。

### 登录成功后立即回到登录页

- 本地 HTTP 使用 `secureCookies: false`。
- 生产必须使用 HTTPS，并设置 `COOKIE_SECURE=true`。
- 检查 Nginx 是否传递 `X-Forwarded-Proto $scheme`。
- 确认请求确实从本机 loopback Nginx 转发，而不是直接公开 3100。

### 生成报告 `ASSET_NOT_FOUND`

- 固定资源 URL 应使用 `/assets/...`，并对应 `public-assets/...` 下的真实文件。
- 上传资源应使用 `/uploads/...`，并对应 `uploads/...` 下的真实文件。
- 不要把背景主题键当作图片 URL；页面模板会把 `home/hui/yi/yang/le/chuan` 映射为拆分后的顶部和底部装饰。
- 修正路径后执行 `npm run generate`。

### 后台保存成功但生成失败

数据库修改已经保存，旧静态站仍然可访问。根据错误修复缺失资源、无效链接或页面关系，然后在后台点击“重新生成全部网站”，或执行：

```bash
npm run generate
```

### 页面无法删除

先删除或移动其子页面，再删除指向该页面的其他 Card。首页不能删除。

### 图片替换后仍显示旧图

1. 查看生成 HTML 中图片 URL 的 `?v=` 是否已经变化。
2. 查看 `public-generated/asset-manifest.json` 中对应路径的哈希。
3. 确认 Nginx/CDN 缓存键保留 `v` 参数。
4. 如果修改过 CDN 规则，刷新对应资源缓存。

### SQLite 锁或写入冲突

- 确认 PM2 为 Fork、`instances: 1`。
- 停止额外的 `npm start`、旧 PM2 进程或重复定时生成任务。
- 不要用 Cluster 模式共享本地 SQLite、uploads 和发布目录。

### Let's Encrypt / ACME 自动续期失败

- 确认 `/www/wwwroot/yl.example.com/.well-known/acme-challenge/` 存在且 Nginx 服务账户可读。
- 确认 `location ^~ /.well-known/acme-challenge/` 仍位于通用点文件拒绝规则之前。
- 如果宝塔生成了独立的 80 端口跳转配置，在 HTTPS 重定向前保留 ACME location。
- 不要把 ACME 校验文件放入 `public-generated/`；完整重建会替换该目录。
- 修改配置后先执行 `nginx -t`，成功后再重载 Nginx。

### 查看运行日志

```bash
pm2 status
pm2 logs aging-finance
tail -n 100 logs/pm2-error.log
```

最后检查：

```bash
curl http://127.0.0.1:3100/health
```
