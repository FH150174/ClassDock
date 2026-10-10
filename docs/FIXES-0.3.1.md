# 0.3.1：休眠唤醒后恢复课程表固定位置

## 原因与修改

旧版主窗口位置由 window-state 插件管理：移动时只更新内存，正常退出才写文件；休眠唤醒没有位置恢复入口。启动时还会先显示居中的窗口。

新版本为主窗口独立记录固定坐标：

- Windows 原生拖动开始、结束消息界定用户移动，拖动结束后由后台线程保存。系统临时居中、最小化或重新排列显示器不修改固定坐标。
- 接收到睡眠/休眠恢复、显示器变化或缩放变化后延迟恢复，并在接下来几秒重试，以等待显示器稳定。恢复期间用户拖动以新位置为准。
- 启动时先隐藏窗口，读取坐标后再显示；从托盘显示也恢复固定位置。没有历史记录时记住首次默认位置。
- 正常退出时同步保存最新坐标，与后台写入串行化，避免拖动后立即退出丢失新位置。
- 保留多显示器负坐标；显示器断开时暂放到可见工作区，不覆盖原坐标。接回显示器后可恢复。

位置文件为应用配置目录下的 widget-position.json，仅保存版本和 x/y；通过临时文件替换写入。首次升级读取旧 .window-state.json 的主窗口坐标，包括旧插件只保存 POSITION 时尺寸为零的记录。若旧版未保存到期望位置，需要重新拖动一次，再按需锁定。

## 验证方法

前端检查使用 npm run check；Rust 检查使用 cargo test、cargo clippy --all-targets -- -D warnings 和 cargo fmt -- --check。

独立原生测试使用隔离目录 .cache，不读写正式课表或授权：

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --example settings_smoke --features tauri/custom-protocol --locked --offline
cargo run --manifest-path src-tauri/Cargo.toml --example position_smoke --features tauri/custom-protocol --locked --offline
cargo run --manifest-path src-tauri/Cargo.toml --example position_smoke --features tauri/custom-protocol --locked --offline -- --restore
cargo run --manifest-path src-tauri/Cargo.toml --example position_smoke --features tauri/custom-protocol --locked --offline -- --quick-exit
cargo run --manifest-path src-tauri/Cargo.toml --example position_smoke --features tauri/custom-protocol --locked --offline -- --restore
```

位置测试模拟用户完成拖动，等待新坐标写入，临时居中后发送 Windows 自动恢复通知，再检查固定坐标、托盘重新显示和重启；快速退出模式在拖动后直接退出，下一进程检查磁盘位置恢复。测试等待 Tauri 跨线程移动实际完成后才发送拖动结束通知，避免测试消息越过排队中的移动请求。

设置测试检查真实 React 设置页两次创建、复用与关闭；按设置窗口标签等待加载，并等待窗口注册完成。custom-protocol 功能使示例读取内嵌构建页面，测试前需要 npm run build。

测试不会让电脑真正休眠。合成 Windows 消息验证恢复代码路径，真实硬件休眠与显示器重连仍需用户环境验证。

原生通知依据：[WM_EXITSIZEMOVE](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-exitsizemove)、[PBT_APMRESUMEAUTOMATIC](https://learn.microsoft.com/en-us/windows/win32/power/pbt-apmresumeautomatic)。

## 本轮结果

- npm run check：ESLint、63 项前端测试、TypeScript 与 Vite 构建通过。
- Rust：11 项单元测试、所有目标 Clippy 和格式检查通过。
- Windows 原生位置测试：拖动落盘、模拟恢复通知、托盘显示、跨进程重启、拖动后快速退出再重启均通过。
- Windows 原生设置测试：真实 React 页面连续两轮渲染、复用、关闭通过。
- 两轮代码审查通过，退出保存竞争与初次启动位置空缺已修正。

回归测试在修复前失败于“拖动结束后没有立即保存固定坐标”；修复后使用内嵌页面的上述命令全部成功退出。原生示例没有正式程序图标资源，可能输出图标提示；WebView2 退出也可能输出窗口类注销提示，测试成功与否以断言和退出码为准。

## 安装产物

0.3.1 Windows x64 NSIS 安装包构建成功，发布程序已在本机重新启动并生成独立位置文件。

- 程序 SHA-256：414DDEB78F358E33E80A03FDABC6B23168D4453F0AF7F8998BF737F775D0677C
- 安装包 SHA-256：41DAB89FB88B07A01966AE11D86FF6AD062E071F2B2240991F85C0EB06B4CEDE
