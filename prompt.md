请在当前工作区直接开发并交付一个完整、可运行的网站项目，不要只给出架构建议或代码片段。先检查当前目录、AGENTS.md及我同时上传的四张设计图，然后完成编码、初始化数据、运行测试和页面视觉检查。

设计参考图：

 - resources 目录下的所有图片都可以使用，包括和不限于裁剪、改变尺寸、大小等
 - 由于有特殊字体要求，对于像标题、图文卡上的文字在html中一律按图片处理，但可以通过OCR来分析各个页面之间的关系
 - 未给出设计图的页面，可以继承上级页面的风格和元素设计
 - 页面上的元素，特别是图文卡，如果没有链接到下级页面则都为外链，注意所有链接都应该可以在管理页面修改和删除

一、项目目标

开发一个养老金融主题的静态展示网站及其管理后台。

公开页面主要由以下内容组成：

- 页面背景和顶部、底部装饰
- Logo
- 页面标题、副标题
- 返回父页面按钮
- 图文Card链接
- 纯文字链接列表
- 内容展示区域
- 版权信息

管理员在后台增加、修改、删除页面或Card后，系统先把数据保存到SQLite，再通过EJS生成新的静态HTML。普通访客访问时不得查询SQLite，也不得在请求时执行EJS渲染。

公开页面没有任何输入框，也不是SPA。

二、强制技术栈

必须使用：

- Node.js当前受支持的LTS版本
- Express 5
- better-sqlite3
- EJS
- 原生HTML5
- 原生CSS
- 原生JavaScript
- multer处理图片上传
- PM2单进程部署

禁止使用：

- Vue
- React
- Angular
- Astro
- Next.js
- Nuxt
- 前端路由器
- MySQL或PostgreSQL
- ORM
- 在公开页面运行时查询SQLite
- 在公开页面请求时动态调用res.render()
- 将整张设计稿截图直接作为网页背景或整页图片

项目应保持简单清晰，避免不必要的抽象和依赖。

三、设计稿还原要求

逐张检查resources目录下的所有设计图，尽量准确还原：

- 720px宽竖屏移动端设计比例
- 米黄色主背景
- 红色、金色、棕色视觉体系
- 首页Logo、标题、红色圆形入口
- 二级页面顶部书法装饰字
- 红色圆形返回按钮
- 金棕色页面标题和下划线
- 白色圆角Card及细金色边框
- 底部红金色道路、人物、树木等装饰氛围
- 文字政策链接列表
- 页面留白、间距、圆角、字号和视觉层级

页面必须移动端优先：

- 在720px宽度下尽量贴合设计稿。
- 在更窄手机上按比例自适应，不产生横向滚动。
- 在较宽桌面上，将主要移动端画布居中显示，不要无节制拉伸。
- Card数量增加后页面必须自然向下延伸。
- 养老课堂的Card在手机端保持CSS Grid双列排版。
- 其他列表可根据内容与屏幕宽度使用单列、两列或三列。
- 当前Card高度较规则，不要为了“瀑布流”强行引入大型JS布局库。
- 页面不能使用固定高度限制Card数量。

背景不能通过拉伸一张完整长图适配任意页面高度。应尽量拆分或组织为：

- 可延伸的中间背景
- 顶部装饰层
- 底部装饰层
- 页面内容层

底部装饰必须位于全部Card之后，不能随着Card增加而覆盖内容。

如果工作区只有完整设计稿，没有独立Logo、背景、Card图片素材：

- 先检查是否能从设计稿中合理裁切干净的局部素材。
- 不要把整张截图作为页面。
- 无法可靠提取的素材应建立清晰的占位资源和替换位置。
- 在README中列出仍需替换的正式品牌素材。
- 即使素材不完整，也要继续完成可运行的最终项目，不要只停留在分析阶段。

四、公开页面模板

使用EJS partials实现类似组件化的复用，至少拆分：

- head
- header
- back-button
- card
- text-link
- footer
- page-background

至少实现以下模板类型：

1. home

首页模板，包括Logo、主标题、副标题、五个圆形入口“惠、医、养、乐、传”。

2. card-list

用于二级、三级及后续层级的Card列表页，包括标题、返回按钮、Card图片、Card标题和跳转链接。

3. content

用于带大块内容区域的页面，可以显示图片、HTML安全文本、PDF链接或其他静态内容。

4. link-list

用于“国家养老政策”这种纯文字链接列表页面。

页面层级不得写死成三级。使用parent_id构成父子树，至少支持设计图中出现的四级页面，并防止循环父子关系。

页面URL按照父子路径生成，例如：

/le/
/le/company-a/
/le/company-a/detail/

每个目录生成index.html。

返回按钮必须指向数据库中记录的父页面URL。可以在同站访问时辅助使用history.back()，但必须存在明确的父页面href，确保用户从二维码或微信直接进入时仍能正确返回。

五、SQLite数据结构

使用better-sqlite3，开启：

- foreign_keys
- WAL模式
- prepared statements
- transactions

至少包含以下数据表。

1. site_settings

保存：

- 网站名称
- Logo
- 首页标题
- 首页副标题
- 版权文字
- 默认背景
- 其他全局配置

2. pages

至少包含：

- id
- parent_id
- title
- slug
- template_type
- decorative_character
- background_image
- content
- sort_order
- status
- created_at
- updated_at

要求：

- 同一父页面下slug唯一
- 防止父子循环
- 删除存在子页面的页面时默认拒绝，并给出清晰提示
- 页面路径由祖先slug自动计算
- 修改slug或父页面后能够清理旧的静态输出路径

3. cards

至少包含：

- id
- page_id
- item_type
- title
- description
- image_path
- image_alt
- target_page_id
- external_url
- sort_order
- status
- created_at
- updated_at

item_type至少支持：

- image_card
- text_link

内部页面跳转优先使用target_page_id，生成时解析为实际静态URL。外部链接使用external_url，并限制为安全协议。

4. media

至少包含：

- id
- original_name
- stored_name
- relative_path
- mime_type
- file_size
- content_hash
- created_at

上传文件只允许安全的图片格式，例如PNG、JPEG、WebP。限制大小，校验MIME类型，防止路径穿越，不允许上传可执行文件和未经处理的SVG。

六、管理后台

管理后台使用原生HTML/CSS/JavaScript，不使用Vue。

入口：

/admin/

认证方式：

- 不需要用户名
- 只有一个管理密码
- 密码允许明文保存在public目录之外的私有配置文件中
- 不得把密码输出到前端JavaScript
- 登录由Express后端验证
- 使用签名的HttpOnly Cookie
- Cookie设置SameSite
- 公网HTTPS环境启用Secure
- 增加简单的登录频率限制
- 管理API全部进行登录校验

管理功能至少包括：

- 登录和退出
- 查看页面树
- 新增页面
- 修改页面
- 删除页面
- 设置父页面
- 选择页面模板
- 设置标题、slug、背景图和装饰字
- 新增Card
- 修改Card
- 删除Card
- Card向上、向下排序
- 上传或替换Card图片
- 设置内部页面链接
- 设置外部链接
- 查看生成后的页面
- 手动“重新生成全部网站”
- 显示生成成功或失败信息

管理页面保存修改后自动重新生成公开静态站，同时保留“重新生成全部网站”按钮作为恢复手段。

七、静态页面生成

EJS只用于发布阶段生成文件，不得在普通访客访问时动态渲染。

推荐目录：

- views/：EJS模板和partials
- public-generated/：最终生成的公开HTML
- public-assets/：CSS、JS、图片等公开资源
- uploads/：后台上传的媒体
- data/：SQLite数据库
- admin/：管理后台静态文件
- server/：Express后端代码

生成过程要求：

1. 从SQLite读取已发布页面。
2. 构建完整页面树和URL。
3. 校验重复路径、孤立页面和无效内部链接。
4. 为每个页面选择对应EJS模板。
5. 生成真实的index.html。
6. 生成前先写入临时文件或临时目录。
7. 成功后再替换正式输出，避免留下半生成页面。
8. 页面删除或slug修改后清理旧HTML。
9. 生成失败时不得破坏当前可访问版本。
10. 提供完整重建功能。

网站规模较小，可以优先采用完整重建，保证首页、父栏目、导航和内部链接同时更新。

八、文件内容哈希与缓存处理

必须实现自动文件哈希，不使用手写版本号，也不能使用Date.now()作为永久版本值。

使用SHA-256计算图片、CSS和JS的内容哈希，取前8至12位，例如：

/images/bg.png?v=8f31c9a2

实现统一的EJS asset()辅助函数，例如：

<%= asset('/images/bg.png') %>

它应自动输出带内容哈希的URL。

要求：

- 文件内容没有变化，哈希必须保持不变。
- 文件内容变化，哈希必须自动变化。
- 管理员替换同名图片后，重新生成的HTML必须使用新哈希。
- 生成阶段建立asset-manifest.json。
- 不在每次HTTP请求时重新计算哈希。
- <img>、CSS、JavaScript和背景图都必须通过asset()处理。
- 外部CSS中的background-image也必须获得真实图片哈希。
- 可以通过EJS生成CSS，或者由HTML注入CSS变量。
- 不能只给style.css加哈希而让CSS内部背景图继续使用无版本URL。

目标效果：

旧页面：

/images/bg.png?v=8f31c9a2

替换图片并重新发布后：

/images/bg.png?v=71d604bf

管理员不需要手动修改任何版本号。

缓存策略：

- HTML：Cache-Control: no-cache
- 带内容哈希的图片、CSS、JS：public, max-age=31536000, immutable
- /admin/：no-store
- /api/：no-store

如果提供腾讯云CDN说明，明确提醒缓存键必须保留v参数，不能忽略全部查询参数。

九、Express服务器

Express负责：

- 管理后台API
- 登录认证
- SQLite操作
- 图片上传
- 静态网站生成
- 开发环境和无Nginx环境下的静态文件托管
- 健康检查接口

生产环境默认监听：

127.0.0.1:3100

端口必须可通过PORT环境变量修改。

在Nginx后面运行时正确配置trust proxy，只信任本机代理。

提供：

- GET /health
- /admin/
- /api/
- 开发环境下的公开静态页面访问

不要在代码中写死最终域名。站内链接使用根路径或根据配置生成。

十、腾讯云、宝塔和Nginx部署文件

项目需要提供：

1. ecosystem.config.cjs

要求：

- PM2 Fork模式
- instances: 1
- NODE_ENV=production
- cwd使用可替换的绝对路径说明
- 自动重启
- 关闭watch
- 日志路径明确

不要使用Cluster多实例，因为项目使用：

- better-sqlite3
- 本地Session或签名Cookie
- 本地文件上传
- 静态页面生成和目录替换

2. deploy/nginx-subdomain.conf.example

假设二级域名：

yl.example.com

Node监听：

127.0.0.1:3100

生产环境推荐：

- Nginx直接提供public-generated和公开静态资源
- /api/反向代理给Express
- 必要的管理请求反向代理给Express
- HTML设置no-cache
- 带哈希资源长期缓存
- 正确传递Host、X-Real-IP、X-Forwarded-For、X-Forwarded-Proto
- 不对公网开放3100端口

3. README.md

详细说明：

- 本地安装
- 初始化数据库
- 启动开发环境
- 默认管理密码在哪里修改
- 如何生成示例网站
- 如何上传和替换图片
- 文件哈希机制
- 如何完整重建
- PM2部署
- 宝塔中添加二级域名
- Nginx反向代理或直接提供静态文件
- SSL配置
- SQLite和uploads备份
- 腾讯云CDN缓存参数注意事项
- 正式品牌素材替换位置

十一、示例数据

创建初始化脚本和种子数据，尽量对应设计稿：

首页入口：

- 惠
- 医
- 养
- 乐
- 传

示例二级页面：

- 精神文化和社会价值

示例Card：

- 云南新东方文旅集团有限公司
- 云南新华文旅集团有限公司
- 云南圣爱健康管理有限公司

示例文字链接页：

- 国家养老政策

准备若干政策文字链接作为演示数据。

种子数据必须能生成首页、二级、三级和四级示例页面，用于验证父子关系和返回逻辑。

十二、代码质量与验收

必须实际完成以下验证：

- 安装依赖成功
- 数据库初始化成功
- Express启动成功
- 登录功能可用
- 页面CRUD可用
- Card CRUD可用
- 图片上传可用
- 全站静态生成成功
- 页面删除后旧HTML消失
- slug修改后旧路径被清理
- 父子页面返回链接正确
- 同级重复slug被阻止
- 页面树循环被阻止
- 替换图片后文件哈希发生变化
- 未修改图片的哈希保持不变
- HTML中实际出现?v=<hash>
- CSS背景图也带正确哈希
- 手机宽度无横向滚动
- Card增加后页面自然增高
- 底部装饰不覆盖Card
- 管理API未登录时拒绝访问
- SQLite、配置文件和模板不能通过公开URL访问

使用浏览器或Playwright进行视觉检查，至少检查：

- 720×1560
- 390×844
- 桌面宽度

将实现结果与四张设计图进行对比，修复明显的间距、比例、字体、颜色和溢出问题。

十三、执行要求

请直接实施，不要只输出计划。

工作顺序：

1. 检查现有文件和设计图。
2. 制定简短实施计划。
3. 创建完整项目。
4. 初始化数据库和示例数据。
5. 启动并测试。
6. 使用浏览器检查页面。
7. 修复发现的问题。
8. 最终给出简洁交付说明，包括：
   - 已完成内容
   - 启动命令
   - 管理后台地址
   - 默认密码位置
   - 生成目录
   - 测试结果
   - 仍需要我提供或替换的正式图片素材

除非确实遇到无法继续的关键阻塞，不要反复向我确认细节；根据设计稿和以上要求做合理判断并完成可运行成品。
