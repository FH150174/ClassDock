# 0.2.0 本地课程导入

用户要求课程来源不限于 Google Calendar。本版增加 ICS、CSV、粘贴内容与手动课程，Google OAuth 与 API 在线同步仍未实现。

## 实现

- 统一 CourseEvent 模型，Mock 与 Local Provider 可切换；文件与手动课程一起显示。
- 先预览再确认，取消不更改现有数据；同名重新导入替换对应文件。
- 文件原文与手动课程保存于 WebView localStorage；每次修改先读取最新存储，写入成功才更新内存。
- 保存失败和损坏存储不会静默覆盖已有课程；移除可撤销，同名新版冲突时拒绝撤销覆盖。
- 设置保存后刷新课程，同源 storage 事件使独立设置页面更新主课表；手动刷新同样读取最新保存数据。
- ICS 通过 ical.js 解析，CSV 通过 Papa Parse 解析；文本作为纯文本处理。无外部上传、Google 请求或授权。
- UTC / IANA / 支持的 VTIMEZONE 正确换算；UNTIL、EXDATE、RDATE 与调课/取消实例统一按绝对毫秒比较，例外按 UID 隔离。
- 重复展开与内嵌时区规则预先限制，明确拒绝不可能和复杂规则，防止解析库无限迭代。
- 日期/时间表单使用 input 事件，修复受控输入重新渲染时恢复默认值的问题。

## 验证

- npm run check：ESLint、55 项自动测试、TypeScript 与 Vite 生产构建通过。
- 自动测试覆盖 CSV 引号/换行/BOM/错误行、重复范围、每周多星期、UTC 截止/排除/附加日期、取消附加实例、UTC 调课、跨 UID 隔离、标准年度夏令时、不可能事件/时区规则拒绝、存储失败、重新加载、同名替换与撤销冲突。
- 浏览器界面：实际 CSV 文件选择、粘贴 CSV/ICS、预览/取消/确认、主课表显示、页面重载保留、手动每周课程、自定义时间输入、移除/撤销、错误 CSV 不覆盖、两个独立页面自动更新均通过。
- 界面截图来自 430×650 浏览器视口，非原生窗口截图。测试数据均为本次创建的示例。
- Rust check / clippy / fmt / test 通过；Rust unit test 为 0 项，原生测试单独运行。

## 边界

- XLSX 请先另存为 CSV UTF-8；不支持学校特定文件格式。
- ICS 相关时间年份限制 1900–2100，预先拒绝超长持续时间，避免异常远期事件造成庞大时区展开。
- 复杂 BY*（只接受 WEEKLY 的普通 BYDAY）、范围调课、高频规则和复杂时区明确拒绝。标准年度夏令时时区可用。
- 重复课程过去 7 天 / 未来 90 天；手动每周课程跨度最长两年。
- 2 MB / 文件、3 MB 总保存、10 文件 / 300 手动记录、5000 展开课程；ICS 最多 2000 事件，每次最多遍历 10000 个重复候选。
- 保留完整源文件内容，磁盘源文件变更需重新导入。清除应用存储会丢失课程，请保留源文件。
- 原生鼠标关闭和拖动未通过本次自动化测试；设置回归使用真实 WebView 页面、生产 open_settings 命令与窗口关闭 API。

## 最终原生产物

- npm run tauri build 成功，NSIS 安装包约 1.62 MiB。
- 最终前端资源生成后，settings_smoke 再次通过两轮真实 React 设置页渲染、窗口复用、关闭与重建，退出码 0。
- 示例测试缺少应用图标资源以及 WebView 退出时 Chrome_WidgetWin_0 的 1412 提示不影响测试结果；正式安装包包含图标。
- 可执行文件：src-tauri/target/release/classdock.exe，SHA256：F357F4F2C043958851FB4EAF66B3A65A68A2C26CE0A14623A26965D912A244AF
- 安装程序：src-tauri/target/release/bundle/nsis/ClassDock_0.2.0_x64-setup.exe，SHA256：E9FE7A16CFB7AFE37C0CFAF6594204E17CD28B0DD08097E4807C1ED950E99622
