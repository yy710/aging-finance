# 首页 V2 生产发布故障复盘与恢复手册

- 日期：2026-07-30
- `source_agent`：Codex
- 影响分支：`home-v2`
- 生产公开路径：`https://www.all2key.cn/af/`
- 生产项目路径：`/www/wwwroot/aging-finance`
- 关联提交：
  - `ba8da4a revert: remove homepage welcome modal`
  - `3488bd2 feat: align homepage with v2 design`
  - `07947c7 fix: preserve production asset paths during publish`
  - `c41867b fix: stabilize production install and homepage cache`

本文记录首页 V2 上线期间出现的静态资源丢失、PM2 502、原生模块安装脚本被拦截和旧图片不可变缓存污染问题。目标是让后续维护人员能够根据可观察证据定位故障，而不是通过反复重启、清空目录或修改 Nginx 猜测原因。

## 1. 最终结论

本次不是单一故障，而是四个连续问题：

1. 旧命令 `npm run generate` 默认按根路径 `/` 生成，生产环境却部署在 `/af`，导致 CSS 和图片 URL 缺少 `/af`。
2. 拉取发布路径修复后执行 `npm ci --omit=dev`，新版 npm 的 `allowScripts` 策略阻止了 `better-sqlite3@12.11.1` 的安装脚本。
3. `better-sqlite3` 原生绑定缺失导致 Express 启动即退出，PM2 连续重启后进入 `errored`，Nginx 因无法连接 `127.0.0.1:3100` 返回 502。
4. 服务恢复后，HTML 和 CSS 已经是 V2，但固定图片 URL 的不可变缓存仍返回旧的 398×46 图片，导致图片高度和后续入口位置看起来仍像旧版。

最终修复：

- 生产生成命令固定 `/af`，本地根路径生成改为显式的 `npm run generate:root`。
- 生产运行配置在没有显式覆盖时安全默认到 `/af`。
- 后台发布结果显示实际使用的公开路径。
- `package.json` 只批准固定版本 `better-sqlite3@12.11.1` 执行安装脚本。
- V2 文案图保持逐像素一致，但无损重新编码为新内容哈希 `da7b742696`，绕过错误的不可变缓存条目。

## 2. 预期发布架构

生产请求链路：

```text
浏览器 /af/*
  -> Nginx 删除 /af 前缀
  -> Express 内部 /*
  -> public-generated/ 静态快照
```

关键边界：

- 浏览器和生成 HTML 使用 `/af/...`。
- Express 直接监听 `127.0.0.1:3100`，内部路由不包含 `/af`。
- `public-assets/` 是固定源资源。
- `uploads/` 是后台上传源资源。
- `public-generated/` 是可重建发布产物，不能手工编辑。
- `data/site.db` 是内容源，生产页面数和资源数会随数据库、上传文件变化。

## 3. 首页 V2 的正确状态

设计画布为 720×1560：

- 组合文案图：527×278，坐标约 `(110, 624)`。
- 第一排入口：`(68, 982)`、`(288, 982)`、`(507, 982)`。
- 第二排入口：`(183, 1153)`、`(400, 1153)`。
- 响应式 CSS：
  - 文案图宽度 `73.1944%`
  - 左边距 `15.2778%`
  - 上边距最大 `68px`
  - 入口区上边距最大 `80px`
  - 网格左边距 `9.4444%`

公开路径保持：

```text
/af/assets/images/home/tagline.png?v=<content-hash>
```

最终 V2 文案图：

- 固有尺寸：527×278
- 新哈希前缀：`da7b742696`
- 与 `resources/首页_一点接入养老无忧_v2.png` 解码后的像素完全一致

## 4. 故障时间线与证据

### 4.1 弹窗消失，但首页布局未更新

弹窗模板、脚本和素材已经回退，因此弹窗消失是符合预期的。首页布局仍旧通常说明公开站点还在读取旧静态快照、旧 CSS 或旧图片响应，不能据此判断 Git 分支没有更新。

正确检查顺序：

1. 查看当前分支和提交。
2. 查看生成 HTML 中 CSS、图片的版本 URL。
3. 查看浏览器实际解码图片的 `naturalWidth`/`naturalHeight`。
4. 查看直接 HTTP 下载的文件尺寸和 SHA-256。

### 4.2 裸生成命令导致所有图片消失

旧行为：

```bash
npm run generate
```

会输出：

```html
<link rel="stylesheet" href="/assets/css/site.css?...">
<img src="/assets/images/home/tagline.png?...">
```

生产浏览器位于 `/af/`，因此这些路径请求错误位置。

修复后的行为：

```bash
npm run generate
```

等价于：

```bash
node scripts/generate.js --public-base-path /af
```

本地直接访问 Express 根路径时使用：

```bash
npm run generate:root
```

### 4.3 PM2 进入 `errored`，外部返回 502

观察到：

```text
PM2 status: errored
pid: 0
unstable restarts: 18
Could not locate the bindings file
node-v137-linux-x64/better_sqlite3.node
Node.js v24.18.0
```

解释：

- 502 是 Nginx 的结果，不是根因。
- 根因是 Express 无法加载 SQLite 原生模块，因此 3100 端口没有持续监听。
- PM2 刚显示 `online` 不能证明恢复；进程可能数秒后再次退出。
- 必须同时确认 PM2 稳定、原生模块可加载、内部 `/health` 返回 200。

### 4.4 `ignore-scripts=false` 但重建仍未执行

安装输出明确显示：

```text
better-sqlite3@12.11.1 install script blocked because it is not covered by allowScripts
```

`ignore-scripts` 和 `allowScripts` 是不同控制层：

- `ignore-scripts=false` 只表示未全局禁用生命周期脚本。
- `allowScripts` 决定具体依赖是否获准运行安装脚本。

失败尝试：

```bash
npm_config_ignore_scripts=false npm rebuild better-sqlite3
```

npm 仍报告 `rebuilt dependencies successfully`，但安装脚本实际被 `allowScripts` 拦截，原生 `.node` 文件没有生成。不要只相信 rebuild 的成功摘要，必须运行模块级 smoke test。

仓库级修复：

```json
{
  "allowScripts": {
    "better-sqlite3@12.11.1": true
  }
}
```

安全要求：

- 只批准明确审查过的固定版本。
- 不使用 `npm install-scripts approve --all`。
- 不使用 `--dangerously-allow-all-scripts` 作为长期方案。

### 4.5 HTML/CSS 是 V2，但浏览器仍显示旧文案图

线上检查结果：

- CSS URL：`site.css?v=79c3759b37`
- 文案图 HTML 尺寸：527×278
- V2 CSS：左边距 110px、上边距 68px、宽度约 527px
- 固定图片 URL：`tagline.png?v=d14ae04315`
- Chrome 实际解码：398×46
- 固定 URL 的独立 `curl` 下载：398×46，SHA-256 为 `6865ca...`
- 增加临时查询参数后的下载：527×278，SHA-256 为 `d14ae0...`
- 响应头：`Cache-Control: public, max-age=31536000, immutable`

这证明问题不只是 Chrome 本地缓存：固定 URL 在 HTTP 缓存层已经绑定到旧文件，而新的查询字符串能够取得正确源文件。缓存具体由 Nginx、CDN 或其组合中的哪一层写入，需要结合生产缓存配置进一步确认；本次恢复不依赖猜测具体缓存产品。

修复方式：

- 不覆盖并继续复用已经污染的不可变 URL。
- 将相同像素无损重新编码，生成新内容哈希。
- 重新发布，让 HTML 引用 `tagline.png?v=da7b742696`。

## 5. 标准生产部署流程

以下路径以本次实际服务器为准：

```bash
cd /www/wwwroot/aging-finance
```

### 5.1 拉取前检查

```bash
git status --short --branch
git rev-parse --short HEAD
git branch --show-current
```

预期分支：

```text
home-v2
```

如果此前手工执行 `npm install-scripts approve better-sqlite3`，`package.json` 可能存在服务器本地修改。先查看差异：

```bash
git diff -- package.json
```

只有在确认差异仅为同一条 `better-sqlite3@12.11.1` 审批时，才可暂存该服务器本地修改：

```bash
git stash push -m "server-local npm approval" -- package.json
```

### 5.2 安装和原生模块验证

```bash
git pull origin home-v2
npm ci --omit=dev
```

安装输出不应再包含：

```text
better-sqlite3 ... install scripts blocked
```

模块 smoke test：

```bash
node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); console.log(db.prepare('select 1 AS ok').get()); db.close();"
```

预期：

```text
{ ok: 1 }
```

若固定版本在当前 Node/系统没有可用预编译文件，安装构建工具后从源码重建：

```bash
dnf install -y gcc gcc-c++ make python3 python3-devel
npm rebuild better-sqlite3 --build-from-source --foreground-scripts
```

### 5.3 生成静态快照

```bash
npm run generate
```

生成后确认：

```bash
grep -n 'tagline.png' public-generated/index.html
file public-generated/assets/images/home/tagline.png
sha256sum public-generated/assets/images/home/tagline.png
```

预期包含：

```text
tagline.png?v=da7b742696
PNG image data, 527 x 278
```

页面数和资源数由生产数据库和上传目录决定。本地示例库验证为 24 页面、83 资源；本次生产数据库曾生成 27 页面、132 资源。数量不同本身不是故障。

### 5.4 启动并验证服务

```bash
APP_ROOT=/www/wwwroot/aging-finance \
  pm2 startOrReload ecosystem.config.cjs --update-env

pm2 save
pm2 status
curl -i http://127.0.0.1:3100/health
```

至少等待数秒后再次执行：

```bash
pm2 status
pm2 logs aging-finance --lines 100 --nostream
```

完成标准：

- PM2 持续为 `online`
- PID 非 0
- 重启次数不继续增加
- 内部 `/health` 返回 HTTP 200
- JSON 中 `status` 和 `database` 均为 `ok`

### 5.5 外部路径和缓存验证

```bash
curl -I https://www.all2key.cn/af/
curl -I 'https://www.all2key.cn/af/assets/images/home/tagline.png?v=da7b742696'
```

浏览器验证：

1. 强制刷新首页。
2. 确认文案图包含“惠、医、养、乐、传”五行说明，而不是旧的单行红字。
3. 确认五个入口整体下移，无重叠或裁切。
4. 在开发者工具或页面脚本中确认图片 `naturalWidth=527`、`naturalHeight=278`。
5. 至少点击一个入口并检查控制台无错误。

## 6. 后台“发布全部更改”的判断方法

后台发布使用运行中 Express 进程创建的生成器，因此依赖：

- PM2 进程使用正确代码和环境变量。
- `PUBLIC_BASE_PATH` 为 `/af`。
- SQLite 原生模块可以加载。
- `public-assets/`、`uploads/` 和 `data/site.db` 可读。
- `public-generated/` 可写并带有生成器所有权标记。

发布成功提示现在包含实际公开路径。生产应显示：

```text
公开路径 /af
```

如果后台报告成功但页面未变化，按以下顺序排查：

1. 检查生成 HTML 的版本 URL是否变化。
2. 检查 `public-generated/asset-manifest.json`。
3. 检查固定 URL直接下载到的真实尺寸和 SHA-256。
4. 比较带额外缓存探针参数的响应。
5. 检查 Nginx/CDN 缓存键是否保留完整查询字符串。

## 7. 验证基线

修复后的本地验证：

```text
git diff --check: pass
JavaScript syntax checks: pass
npm test: 18/18 pass
npm run generate: 24 pages, 83 hashed assets
SQLite in-memory smoke test: pass
V2 source/published decoded pixels: identical
```

生产式浏览器验证曾覆盖：

- 1280×800 桌面
- 378×834 手机
- 首页 11 张图片全部加载
- 无横向溢出
- 控制台无警告或错误
- `/af/` → `/af/hui/` 导航成功

## 8. 回滚与恢复原则

- 不手工编辑 `public-generated/`。
- 生成失败时，生成器会保留上一次完整快照。
- 不删除生产 SQLite 数据或上传目录来修复页面资源。
- 不使用 `git reset --hard` 清理服务器本地配置。
- 先通过 `git status` 和限定文件的 `git diff` 明确修改来源。
- 原生模块故障先修复依赖并做 smoke test，再启动 PM2。
- 内部健康检查通过但外部仍失败时，才继续检查 Nginx。

## 9. 可复用知识点

1. Git 更新源码不等于更新静态发布产物，拉取后必须成功生成。
2. PM2 瞬时 `online` 不等于服务稳定，必须看持续状态和 `/health`。
3. 502 通常意味着上游不可达，应先验证内部端口，而不是先改前端。
4. npm 的 `ignore-scripts` 与 `allowScripts` 是两套独立机制。
5. 原生依赖安装后必须执行真实 `require()`/查询 smoke test。
6. HTML `width`/`height` 与图片 `naturalWidth`/`naturalHeight` 不一致，是资源响应错误的重要证据。
7. `immutable` 缓存条目一旦绑定错误内容，必须发布新 URL；仅覆盖同一路径不可靠。
8. 内容哈希必须对应实际响应字节，不能把同一个版本参数用于不同文件。
9. `/af` 只存在于生产外部路径，Express 内部路由由 Nginx 去掉前缀。
10. 只批准必要的固定依赖安装脚本，不做全局或全依赖放行。

## 10. 相关文件

- `package.json`
- `scripts/generate.js`
- `server/config.js`
- `server/api.js`
- `admin/app.js`
- `public-assets/images/home/tagline.png`
- `views/home.ejs`
- `public-assets/css/site.css.ejs`
- `tests/public-base-path.test.js`
- `tests/generator.test.js`
- `ecosystem.config.cjs`
- `deploy/nginx-subpath.conf.example`
- `.agent-memory/architecture.md`
- `.agent-memory/decisions.md`
- `.agent-memory/bugs-and-fixes.md`
- `.agent-memory/commands.md`
- `.agent-memory/current-state.md`

## 11. 外部参考

- [npm install-scripts：依赖安装脚本审批](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/)
