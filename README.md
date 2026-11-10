# 豆豆ai

一个受登录页截图启发的独立登录 / 注册页面。页面提供用户名、密码和确认密码输入框、密码显示切换，以及登录与注册视图切换；注册页不包含邀请码，也不执行浏览器端表单校验。

## 本地预览

直接在浏览器打开 `index.html` 可预览界面。绿豆照片已压缩后嵌入 `assets/mung-beans.svg`，无须外部图片服务。要测试认证请求，请通过本地 HTTP 服务在 `http://localhost:5500` 或 `http://127.0.0.1:5500` 打开页面，例如运行 `python -m http.server 5500 --bind 127.0.0.1`。认证请求需要联网。

## 认证状态

页面已连接 Supabase 项目 `rdyxakubtwqgcjbrsexl`。Supabase 标准密码登录以邮箱或手机号为标识，因此 `username-auth` Edge Function 会把规范化用户名映射为不可投递的内部 `.invalid` 地址，再调用 Supabase Auth；用户名与密码不会进入客户端存储。登录成功的会话仅保存在当前页面内存中，并通过 `doudou:auth` 事件提供给后续页面代码。

注册表单不做浏览器端校验，也不比较确认密码；服务端仍会执行必要的请求格式检查、Supabase 密码规则和登录/注册频率限制。Edge Function 使用 Supabase Secret Key 创建已确认账户，Secret Key 只从 Supabase Edge Function 环境变量读取，不放进 `config.js`。

部署时需要依次应用 `supabase/username_auth_rate_limit.sql` 和 `supabase/user_memberships.sql`，再部署 `supabase/functions/username-auth/index.ts`，并确认函数的 JWT 验证关闭（匿名注册入口），函数代码会校验 publishable key 和允许的来源。`supabase/config.toml` 已包含相应设置。浏览器端 URL 与 publishable key 位于 `config.js`；这类公钥是公开客户端配置，不是 Secret Key。

当前项目的限流表、账户标记表及新版 Edge Function 已部署。默认允许 `https://sison16.github.io` 和上述两个本地地址；使用其他域名时，需要在 Edge Function 的 `ALLOWED_ORIGINS` 环境变量中添加完整 Origin（多个来源以逗号分隔）。发布到 GitHub Pages 时，将 Pages 的发布来源设为 `main` 分支的根目录。

注册成功返回登录页，登录成功显示账户状态，并提供退出登录按钮。页面刷新后需要重新登录；当前交付范围是账户入口，没有添加 AI 聊天功能或密码找回流程。内部地址不是真实邮箱，不提供邮件找回。

限流表仅可由服务端访问，已启用 RLS 并撤销匿名和普通登录用户权限；没有客户端读取策略是刻意的默认拒绝设置。用户名仅用于显示，后续数据权限必须以 Supabase 用户 ID 和 RLS 实现。

## 上线公告与账户标记

登录后展示「11月16日正式版推出」，日期为北京时间 2026年11月16日。内测资格截止点为 `2026-11-16T00:00:00+08:00`（UTC `2026-11-15T16:00:00Z`），严格不含零点。

新项目首次部署时应用 `supabase/user_memberships.sql`；本项目已应用，请勿重复创建表。只有 Supabase Auth 验证成功的登录才记录资格，注册本身不授予。`user_memberships` 保存最早的已知成功登录时间，既有用户依据 Auth 登录记录回填；重复登录和并发乱序不会丢失原有资格，标记在截止日以后仍保留。

管理员由可信后台按用户 ID 指定，客户端的用户名、时钟、请求参数或 user_metadata 均不能赋予管理员身份。表启用 RLS，匿名和普通用户没有读写权限；仅服务端调用 SECURITY INVOKER 函数 `record_username_login`。当前管理员标记用于账户身份展示，尚未增加管理后台功能。管理员密码及 GitHub 令牌不在仓库中。

数据库回归检查：在 SQL Editor 运行 `supabase/test_memberships.sql`，覆盖截止前、零点、截止后、永久资格、管理员保留、乱序登录及客户端权限。测试数据在事务中回滚。

## 图片署名

- 图片：Tiia Monto（Wikimedia Commons 用户 Kulmalukko），[Mung beans.png](https://commons.wikimedia.org/wiki/File:Mung_beans.png)
- 许可：[Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/)
- 展示方式：页面中以圆角方形裁切显示。
