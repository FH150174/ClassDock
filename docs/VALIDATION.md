# 第一轮验收记录

日期：2026-10-07（Asia/Shanghai）

本次验收范围为用户指定的第一轮：初始化 Tauri + React + TypeScript、Mock UI、今日课程、下一节课、简单本周列表、运行与编译。真实 Google OAuth 与同步属于下一阶段。

## 执行结果

| 验证项 | 结果 / 证据 |
| --- | --- |
| Node / npm | 24.18.0 / 11.16.0 |
| MSVC / WebView2 | Visual Studio 18 Community C++ 工作负载，WebView2 154.0.4258.53 |
| Rust | 独立完整 1.97.1 MSVC 工具链，项目固定版本 |
| `npm install` | 最终 197 个依赖完成审计，未发现已知漏洞 |
| `npm run lint` | ESLint 10、TypeScript 与 React hooks 规则，0 错误 / 0 警告 |
| `npm run test` | 15 个测试全部通过 |
| `npm run build` | TypeScript 严格检查与 Vite 生产构建通过 |
| `cargo check --locked` | 通过 |
| `cargo fmt` | 已格式化 |
| `cargo clippy --locked -- -D warnings` | 通过 |
| `npm run tauri dev` | Vite 服务启动、Rust 编译完成、`target/debug/classdock.exe` 运行 |
| 原生 WebView 渲染 | 可访问性树确认显示 ClassDock、10 月 7 日、下一节课数据结构、三节今日课程、示例模式和收起按钮 |
| Release 实际启动 | `target/release/classdock.exe` 已启动，同样确认生产 WebView 显示课程内容 |
| 浏览器交互 | 今日 → 本周七天列表、设置入口、浅色/深色主题切换通过 |
| `npm run tauri build -- --no-bundle` | Release 应用构建成功 |
| `npm run tauri build` | 中文 x64 NSIS 安装包构建成功，官方工具下载及哈希验证成功 |
| 代码审查 | 通用、React、TypeScript、Rust 专项只读审查通过；本地时区跨日显示及最小化设置恢复问题已修复，hooks 静态检查已补齐 |

生产前端 JS gzip 约 103.8 kB，CSS gzip 约 2.8 kB。Release 应用约 5.9 MiB，NSIS 安装包约 1.58 MiB；这些是文件体积，不代表长期运行内存。未测量后台长期运行内存和 CPU。

## 实测中修复

- 原有 stable Rust 安装损坏：显示版本但缺少标准库和 rustfmt。安装独立 1.97.1 工具链，无需替换全局默认。
- Windows Vite 文件监视触碰 Rust 生成的 exe 报 EBUSY。增加 `server.watch.ignored = ['**/src-tauri/**']` 后重新启动标准开发命令成功。
- UTC 事件在本地跨午夜时，NextClass 结束日期可能丢失。起止两端都转换到本地时区后判断日期。
- 设置窗最小化后重开：先 unminimize 再显示和聚焦。
- 设置窗口切换置顶：由 Rust 命令固定作用于 main，失败时前端提示。
- 长期跨午夜运行：Mock 按日期自动重新生成。

Rust 新版本对 MSVC 创建 cdylib 导入库的正常输出报告 `linker stdout` 提示。编译及链接成功，Clippy 严格检查通过；这不是应用源码警告。Windows 首版保留 Tauri 标准库产物配置。

## 验证限制与手动复核

原生透明窗截图工具连续捕获超时，坐标交互工具未取得窗口几何信息；可访问性文本读取正常。没有用浏览器点击来冒充原生点击验证。当前以下能力已经实现，但未完成原生交互端到端验证：

1. 按住顶部 ClassDock 拖动，开启锁定后确认不可拖动。
2. 设置窗修改置顶、主题及透明度，确认主窗口同步；最小化设置再重开。
3. 托盘右键操作今日、本周、重新加载、设置；收起后单击托盘恢复。
4. 托盘退出后重新启动，确认位置恢复；显示器布局变化时确认窗口可见。
5. 安装包实际安装/卸载，以及另一台 Windows 10/11 上首次运行。

未自动执行安装程序，未添加开机启动项。示例模式没有网络课程缓存，不把 Mock 数据当作真实离线缓存验收。

## 产物校验（SHA-256）

`classdock.exe`：`132576F535AEEA28BA671F0AF4EA5B22FB3D65DC28730475637216A26643F8B1`

`ClassDock_0.1.0_x64-setup.exe`：`F6FAA86978A02D0AEC96350C649238521BC4C5802FB11196E1A4E4E98EAD26CA`

## 未实现且未验收

Google 登录、真实日历列表/选择、真实事件请求、凭证安全存储、真实离线缓存、周期同步、API 错误恢复、开机启动与通知。接入方案与用户需要准备的 Google Cloud 配置详见 README。

截图 `assets/screenshots/widget-light.png` 和 `widget-dark.png` 为浏览器预览截图，作为外观参考；不是原生窗口截图。
