use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

static SETTINGS_WINDOW_LOCK: Mutex<()> = Mutex::new(());

pub fn show_widget(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.unminimize()?;
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_settings(app: AppHandle) -> Result<(), String> {
    // Windows 在同步命令或事件回调中创建 WebView 会阻塞窗口线程。
    tauri::async_runtime::spawn_blocking(move || create_or_show_settings(&app))
        .await
        .map_err(|e| format!("设置窗口任务失败：{e}"))?
}

fn create_or_show_settings(app: &AppHandle) -> Result<(), String> {
    // 连续点击时串行检查与创建，避免同时创建同名窗口。
    let _guard = SETTINGS_WINDOW_LOCK.lock().map_err(|e| e.to_string())?;
    if let Some(window) = app.get_webview_window("settings") {
        window.unminimize().map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    WebviewWindowBuilder::new(
        app,
        "settings",
        WebviewUrl::App("index.html?settings".into()),
    )
    .title("ClassDock · 设置")
    .inner_size(430.0, 650.0)
    .min_inner_size(360.0, 560.0)
    .decorations(true)
    .closable(true)
    .resizable(true)
    .build()
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_widget_top(app: AppHandle, enabled: bool) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("课程表窗口不存在")?;
    window.set_always_on_top(enabled).map_err(|e| e.to_string())
}
