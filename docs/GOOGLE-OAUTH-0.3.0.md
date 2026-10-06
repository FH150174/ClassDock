# Google 日历接入 0.3.0

支持桌面 OAuth 配置 JSON/手填、系统浏览器授权、PKCE/state、回调超时与取消、日历选择、Google + 本地课程、每 10 分钟后台同步、立即同步、退出与离线缓存。选择单一日历，换账号需重新选日历。全流程不提供 Google 写权限。

代码检查：63 项前端测试、7 项 Rust 测试、ESLint、TypeScript/Vite、Rust fmt/Clippy。Google 测试覆盖配置校验、事件合并、坏事件/全天/取消、UTC、离线警告、同步队列、PKCE、回调状态、权限、分页令牌重复、固定网络来源、缓存连接隔离与原子替换。并发锁测试只覆盖状态断言，并非完整线程交错模拟。

实际 Windows 设置窗口两轮测试已通过：渲染、复用、关闭及再次创建均正常。验证使用 settings_smoke 示例，注册生产 Google 命令和服务，读取真实 React 页面，检查 Google 配置/登录控件，重复打开、复用、关闭与重建。测试不会保存测试凭据或登录 Google。

没有用户桌面 OAuth 客户端，尚未实测真实浏览器授权、Google API 数据与真实账号撤销。需按 README 配置后完成；构建成功和模拟测试不代替真实账户验证。

令牌保存 Windows 凭据管理器，Access Token 仅内存。Google 课程缓存写应用数据目录，随机连接标识隔离账号。缓存保存与状态提交共用锁，取消同锁推进代际；新登录、选日历和同步互斥。失败回退旧数据与警告，退出保留本地课程和客户端配置。正在授权时使用取消按钮；同步期间退出会提示稍后重试。

安装包：src-tauri/target/release/bundle/nsis/ClassDock_0.3.0_x64-setup.exe。
