# ClassDock

轻量的 Windows 桌面课程表 Widget，使用 Tauri 2、React、TypeScript、Vite、Rust 和 Luxon。Google Calendar 将是正式版唯一课程数据源；本地仅保存授权、设置和可失效的只读缓存，不建立独立课程数据库。

**当前交付：第一轮 / Phase 1–2。使用 Mock 示例课程，未接入 Google 账户或真实 Calendar API。** 无需凭证即可运行。界面底部和设置页始终标明示例模式。

## 截图

![浅色课程表预览](assets/screenshots/widget-light.png)

[查看深色预览](assets/screenshots/widget-dark.png)。以上为浏览器外观截图；原生窗口截图区域预留。

## 当前功能

- 无传统标题栏，圆角、半透明背景，默认宽度 360px；窗口高度适配内容，最高 780px。
- 当前日期、星期、今日课程数量、时间顺序、地点、结束状态。
- 下一节课 / 正在上课 / 剩余时间 / 明天课程 / 无课程状态。
- 周一到周日分组列表，课程内容内部滚动；顶部与底部固定，不产生页面级滚动条。滚动时显示细滚动条，停止 1.2 秒后隐藏。
- 深色、浅色、跟随系统；背景不透明度 55–100%。
- 拖动整个顶部或日期区域；锁定位置；始终置顶；设置持久化。
- 系统托盘：打开、重新加载示例、今日、本周、设置、退出。
- 收起到托盘、关闭主窗时隐藏；窗口位置在正常退出后保存和恢复。
- 独立设置窗口；仅前端预览时在当前页展示设置。
- Mock 每次加载按当前周生成课程；倒计时每 30 秒更新，窗口重新获得焦点时更新。
- Google 原始事件 → CourseEvent 转换及时间判断已实现，15 项单元测试。

**下一阶段待实现：** OAuth、账户与日历选择、真实 API 请求、过去 7 天 / 未来 30 天缓存、后台自动同步、同步错误分类、托盘设置勾选状态、开机启动（默认关闭）、提醒。第一版不修改启动项。CSS 模糊仅用于面板内部的视觉效果；Windows 桌面背景的原生 Acrylic 和 WorkerW 桌面嵌入留待平台实测，不保证本版具有桌面背景模糊。

## 环境要求

- Windows 10 / 11，推荐 x64。
- Node.js 22.12+ 或 24 LTS，npm。
- Visual Studio / Build Tools：勾选“使用 C++ 的桌面开发”和 Windows SDK。
- Microsoft Edge WebView2 Evergreen Runtime。
- Rust MSVC 工具链。项目通过 `rust-toolchain.toml` 固定 1.97.1，包含 rustfmt 和 clippy。

参见 [Tauri Windows 前置要求](https://v2.tauri.app/start/prerequisites/)。不使用 Electron，不需要额外安装 Chromium。

## 安装与开发

在项目根目录打开 PowerShell：

```powershell
npm install
npm run tauri dev
```

首次运行会下载 Rust 依赖并编译，耗时取决于网络和机器。后续增量构建更快。Tauri 自动启动 Vite 的 `127.0.0.1:1420` 服务；不要同时启动另一份占用该端口的 Vite。

仅预览 UI：

```powershell
npm run dev
```

浏览器打开 `http://127.0.0.1:1420`。浏览器预览没有拖窗、置顶和托盘能力；它不是原生运行验证。

## 测试与构建

```powershell
npm run check
npm run format
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings
npm run tauri build
```

产物：

- `src-tauri/target/release/classdock.exe`：应用程序，可直接启动；需要系统 WebView2。
- `src-tauri/target/release/bundle/nsis/ClassDock_0.1.2_x64-setup.exe`：中文 NSIS 安装程序。

无需安装包时：`npm run tauri build -- --no-bundle`。发布构建去掉控制台，优化体积；本版未配置代码签名。安装程序按 Tauri 默认机制处理缺失的 WebView2。代码和资源都在本地，生产前端无外部字体请求。

## Google Cloud Console 配置（下一阶段）

下面是正式数据接入的准备工作，**当前版本不会读取 `.env` 或发起 OAuth**。

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 创建或选择项目。
2. 在 API 库启用 Google Calendar API。
3. 在 Google Auth Platform 配置品牌信息、受众和数据访问；测试期间添加自己的 Google 账号为测试用户。
4. 创建 OAuth 客户端，应用类型选择 **Desktop app / 桌面应用**，不要创建 Web application 客户端替代。
5. 复制 `.env.example` 为 `.env`，填写自己项目的 `GOOGLE_CLIENT_ID`；如签发的桌面客户端要求 secret，则只在 Rust 后端读取 `GOOGLE_CLIENT_SECRET`。
6. 不要将 `.env`、下载的 OAuth JSON 或 Token 提交到 Git；`.env` 已忽略。不要使用 `VITE_` 前缀承载凭证。

客户端 ID 标识应用而非用户。桌面客户端不能保密客户端 secret；PKCE、state 校验与安全 Token 存储才是本方案的重要保护。Google 的桌面流程允许 loopback 重定向，并将 client secret 标为可选字段：[Google 桌面 OAuth 文档](https://developers.google.com/identity/protocols/oauth2/native-app)。

## 下一阶段 OAuth 与同步方案

实现顺序：

1. Rust `auth.rs` 使用 Authorization Code + PKCE S256；生成随机 verifier 和 state，仅绑定 `127.0.0.1` 的随机端口；设置回调超时并只接收一次有效回调。
2. 通过系统默认浏览器完成授权，避免内嵌 WebView 登录；回调严格验证 state 和 redirect URI，由 Rust 换取 Token。前端仅接收已登录状态。
3. 只请求 `calendar.calendarlist.readonly` 和 `calendar.events.readonly`，分别用于可访问日历列表与事件读取；不请求写入权限。应用只获取选中日历的事件，但 Google 的事件读取授权范围仍涵盖账户可访问的日历，不能宣称 OAuth 授权只限选中日历。参见 [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)。
4. Refresh Token 存入 Windows Credential Manager；Access Token 只保留在 Rust 内存；不写日志。授权取消或 refresh 失效时显示重新登录入口，保留可识别的离线缓存。退出登录清除授权和账户相关缓存。
5. Rust `calendar.rs` 通过 HTTPS 获取分页 `calendarList.list` 和选中 Calendar 的 `events.list`。`singleEvents=true` 展开重复实例，`orderBy=startTime`，IANA 时区、明确时间窗口、字段裁剪和分页完整处理。
6. 用现有 `parseGoogleEvents` 转换领域模型。全天/取消事件过滤，坏事件计数，保留 event ID、calendar ID、description 和 recurringEventId；Google 返回的偏移保留为绝对时刻，界面按系统本地时区显示。
7. `cache.rs` 原子替换过去 7 天和未来 30 天只读缓存；缓存版本、所选日历 ID、范围与 lastSyncTime 显式保存。切换账户和日历时隔离缓存，避免显示错误来源。
8. 默认 10 分钟同步，可选 5 / 10 / 15 / 30 / 60；Rust 后台计时保证隐藏窗口后同步仍工作，手动与自动请求串行，避免叠加。429/5xx 用有上限退避并尊重 Retry-After；断网继续显示上次成功缓存。
9. 区分网络失败、401/refresh 失败、403权限撤销、404日历删除、配额限制和解析失败。下一阶段真实状态包括未登录、待选择日历、同步中、成功、离线、需要重新授权。当前示例模式不会伪造登录成功或 API 同步成功。
10. 经真实 Google 测试后再完成 autostart 插件（默认关闭、仅用户主动开启）、托盘勾选项同步和提醒调度。

## 项目目录

```text
src/
  components/       CourseCard / NextClass / TodaySchedule / WeekSchedule / SyncStatus
  hooks/            30 秒时钟 / 滚动条自动隐藏
  pages/            WidgetPage / SettingsPage
  services/         Provider 接口 / Mock / 时间判断 / 桌面桥接
  stores/           Zustand 日历与设置状态
  types/            原始 Google 事件 / CourseEvent / 设置
  utils/            事件解析
  App.tsx           主题与窗口路由
  styles.css        本地字体与浅深色设计变量
src-tauri/
  src/              lib.rs / main.rs / tray.rs / window.rs
  capabilities/     本地窗口最小权限
  icons/            应用与托盘图标
  tauri.conf.json   透明窗、CSP、NSIS
assets/             SVG 图标源
docs/               运行与验收记录
```

后续 auth / calendar / cache / settings / startup 按职责增添 Rust 模块，不把 Token 或网络逻辑放入 React。CalendarProvider 接口允许替换数据实现；其他 Widget 可复用领域与服务层，不需在本轮引入 Dashboard 框架。

## 时间规则与测试

- CourseEvent 使用带偏移的 ISO 字符串，避免 Date 序列化和缓存恢复歧义；Luxon 操作完整日期，不按字符串切割判断时间。
- 今日课程按本地 `[当天午夜, 下一日午夜)` 相交查询；跨日课程在两天可见，正好午夜结束不会计入第二日。
- 进行中的课程优先于未来课程；起始时刻算进行中，结束时刻不算。重叠课程默认显示开始最早的进行中课程。
- 周从周一开始。DST 按日历日计算，不假定每天固定 24 小时。
- 重复规则由 Google 服务展开；前端不自行推导 RRULE，以避免例外日期、取消实例和夏令时错误。
- 测试覆盖今日排序、进行中、未来课、明天课、无课程、起止边界、跨天、午夜、UTC、本地时区、DST、周分组、重复实例、全天过滤和坏事件。

## 常见问题

**看不到任务栏图标？** 主窗口作为 Widget 默认跳过任务栏，使用系统托盘重新打开。点右上角收起或关闭主窗后仍在托盘运行；退出请用托盘“退出 ClassDock”。

**如何拖动？** 按住顶部任意空白、ClassDock 标识或日期区域即可拖动；刷新、设置和收起按钮仍正常点击。锁定后需在设置中关闭“锁定位置”。窗体不嵌入桌面 WorkerW，保持透明悬浮模式。

**怎么改变示例课程？** 修改 `src/services/mockCalendarService.ts`。示例数据随当前周生成；正式课程最终只能从 Google Calendar 修改。

**同步按钮为什么叫重新加载？** 当前没有连接 Google。按钮只重新生成示例，不发起 Google 请求。

**Rust 提示缺少 std 或格式化程序？** 检查安装是否完整，项目固定工具链后运行 `rustup toolchain install 1.97.1 --profile minimal --component rustfmt --component clippy`，再重试。C++ 链接失败时检查 Windows SDK 和 MSVC 工作负载。

**1420 端口被占用？** 关闭本项目上一份 Vite；不要更改端口而忘记同步 `tauri.conf.json` 的 devUrl。

**为什么没有 Google 登录按钮？** 按本轮先完成 Mock UI 的目标交付，OAuth 尚未实现。设置页明确展示状态，准备自己的 Desktop OAuth 客户端后即可进入下一阶段。

## 隐私

当前无 Google API 请求、无遥测、无账户、无密码和 Token。设置保存在 WebView 本地存储，窗口位置由 window-state 插件写入 Tauri 应用数据目录；正式版计划只缓存所选日历必要的课程字段。课程 description 作为纯文本模型数据处理，不渲染 HTML。本地课程缓存包含个人日程，下一阶段提供退出登录时清除。不存在第二套课程编辑数据库。

## 验收边界

本轮验收：原生 `tauri dev`、前端生产构建、时间测试、Windows exe 构建、Mock 今日/下一节/本周与基础桌面行为。全量最终验收中的真实 OAuth、真实日历选择、真实事件、离线缓存与周期同步需下一阶段完成；不能用示例成功代替真实账户验证。具体执行证据见 [第一轮验收](docs/VALIDATION.md) 和 [0.1.1 窗口与滚动修复](docs/FIXES-0.1.1.md)、[0.1.2 设置窗口修复](docs/FIXES-0.1.2.md)。
