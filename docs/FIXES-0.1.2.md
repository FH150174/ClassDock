# 0.1.2 设置窗口修复与验收

日期：2026-10-07（Asia/Shanghai）。

## 根因与修复

原版通过同步 Tauri 命令和托盘事件回调直接创建 WebView。在 Windows 中，创建过程等待主线程处理 WebView2 消息，同时主线程又在等待创建返回，导致设置窗口空白、关闭消息无法处理。

原生复现：设置窗口的可访问性树只有窗口、标题栏与系统按钮，没有页面；Alt+F4 后窗口仍存在。此行为符合 [Tauri 2.12.1 的已知限制](https://docs.rs/tauri/2.12.1/tauri/webview/struct.WebviewWindowBuilder.html)。

- `open_settings` 改为异步命令，在 `spawn_blocking` 中创建或显示窗口。
- 托盘设置入口派发异步任务并立即返回，避免阻塞窗口事件循环。
- 互斥锁串行执行查找、创建和复用，避免重复创建同名窗口。
- 设置窗口保留原生标题栏与关闭功能；主窗口隐藏到托盘的关闭拦截仅作用于 `main`。

## 验证结果

- `npm run check`：lint 无错误或警告，15 项测试通过，TypeScript 与前端构建通过。
- Cargo check、Clippy（正式代码及新增示例，`-D warnings`）、格式检查通过。
- `npm run tauri build`：Release 应用与中文 x64 NSIS 安装包构建成功。
- 独立原生测试 `settings_smoke`：通过真实前端 IPC 调用 `open_settings`，读取真实 React 设置页面，验证标题、置顶设置和当前版本；再次打开复用窗口，关闭后从管理器注销，再重新创建。连续两轮通过，进程退出码 0。
- 原生测试覆盖窗口关闭 API 和顺序复用；托盘派发路径由代码审查确认，系统关闭按钮未通过鼠标自动点击。Computer Use 截图超时导致坐标输入不可用。
- 通用、Rust、React/TypeScript 只读审查未发现重要问题；`git diff --check` 通过。

## 重跑原生测试

先执行 `npm run build`，再运行：

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --example settings_smoke --features tauri/custom-protocol --locked
```

测试有 60 秒整体超时，使用正式 `window.rs`，报告命令与页面读取脚本仅在独立测试程序中注册。测试清单补充 Windows Common Controls v6；Cargo 示例不继承 Tauri 为正式二进制嵌入的清单，缺失清单会使 `TaskDialogIndirect` 导入触发 `ENTRYPOINT_NOT_FOUND`。清单参数仅作用于 Windows MSVC 示例。测试程序未嵌入正式应用图标，因此可能输出默认图标资源提示；退出时 WebView2 也可能输出窗口类注销提示，不影响成功退出。正式安装包含应用图标。

## Git 约定

本地仓库已初始化为 `main`，0.1.1 基线提交为 `676b974`。用户要求每次完成修改并验证后提交、推送，已记录在根目录 `AGENTS.md`。尚未提供远程仓库地址；本轮修复先保留本地提交，提供地址后推送。

## 产物 SHA-256

| 产物 | SHA-256 |
| --- | --- |
| `src-tauri/target/release/classdock.exe` | `2D2A16A3892926C781EE4E77140401A370D19ED4CBBBF0C422D65A8916FB4ED2` |
| `src-tauri/target/release/bundle/nsis/ClassDock_0.1.2_x64-setup.exe` | `D5A863ED9E4F470DFE8AD0B97C9B7547E0A814F12808DBAEBA5274AB29044C15` |
