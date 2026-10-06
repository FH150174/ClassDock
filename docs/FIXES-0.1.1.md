# 0.1.1 窗口与滚动修复

日期：2026-10-07（Asia/Shanghai）。本记录补充第一轮验收，不覆盖 0.1.0 的历史记录。

## 改动

- 顶部与日期区域使用 Tauri 2.12.1 原生深层拖动区域；工具栏按钮排除，锁定位置时禁用。
- 课程内容统一在窗口内部滚动，顶部与底部保持固定；内容自然高度用于窗口尺寸计算，避免窗口达到 780px 上限后出现外层滚动条。
- 内容与设置页的细滚动条在滚动时显示，停止 1200ms 后隐藏；页面切换时清理并重新绑定监听器。

## 验证

- `npm run check`：lint 无错误或警告，15 项测试通过，TypeScript 与 Vite 构建通过。
- Rust check、格式检查与 `cargo clippy --locked -- -D warnings` 通过。
- `npm run tauri build`：Release 应用和中文 x64 NSIS 安装程序构建成功。MSVC 输出创建导入库的信息被 Rust 标为 linker stdout 警告，不影响构建。
- 浏览器 360×780：文档高度 780，无外层溢出；本周内容可滚动。滚动后 `is-scrolling` 生效，停止后移除，滑块颜色变为透明，滚动位置保留。
- 打开设置、锁定、返回：顶部与日期的拖动区域变为 false；解锁后恢复 deep，工具栏保持 false。返回后滚动监听仍正常。
- 通用、React、TypeScript 当前文件审查未发现高置信重要问题。
- 新版 Release 应用已启动。原生截图工具超时，无法完成自动鼠标拖动验证；浏览器预览不具备原生拖窗能力。

## 产物 SHA-256

| 产物 | SHA-256 |
| --- | --- |
| `src-tauri/target/release/classdock.exe` | `7F852EC8B3E0DC31F5C3A0E1CD56DA946B7D21B4D329CA4CB95A50E5A0B96D35` |
| `src-tauri/target/release/bundle/nsis/ClassDock_0.1.1_x64-setup.exe` | `5562127A42330AF1367F5560432C5DBB9C32B8E68A82F5E7AAD65FEBFE2AC810` |
