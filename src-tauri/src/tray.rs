use crate::window;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, Emitter,
};

pub fn setup(app: &App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "打开课程表", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh", "重新加载示例课程", true, None::<&str>)?;
    let today = MenuItem::with_id(app, "today", "今日课程", true, None::<&str>)?;
    let week = MenuItem::with_id(app, "week", "本周课程", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出 ClassDock", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&open, &refresh, &today, &week, &settings, &separator, &quit],
    )?;
    let mut builder = TrayIconBuilder::new()
        .tooltip("ClassDock · 课程表")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let result = match event.id.as_ref() {
                "quit" => {
                    app.exit(0);
                    Ok(())
                }
                "settings" => {
                    let handle = app.clone();
                    // 托盘回调及时返回，让主线程继续处理 WebView 创建与关闭消息。
                    tauri::async_runtime::spawn(async move {
                        if let Err(error) = window::open_settings(handle).await {
                            eprintln!("无法打开设置窗口：{error}");
                        }
                    });
                    Ok(())
                }
                "refresh" | "today" | "week" => window::show_widget(app)
                    .and_then(|_| app.emit("widget-action", event.id.as_ref())),
                _ => window::show_widget(app),
            };
            if result.is_err() {
                eprintln!("托盘操作失败");
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if window::show_widget(tray.app_handle()).is_err() {
                    eprintln!("无法打开课程表窗口");
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
