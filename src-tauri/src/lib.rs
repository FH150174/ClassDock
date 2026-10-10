mod google;
mod position;
use std::sync::Arc;
use tauri::Manager;
mod tray;
mod window;

pub fn run() {
    let result = tauri::Builder::default()
        .plugin(position::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
                .with_denylist(&["main"])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            window::open_settings,
            window::set_widget_top,
            google::google_status,
            google::google_configure,
            google::google_connect,
            google::google_cancel,
            google::google_calendars,
            google::google_select,
            google::google_load,
            google::google_disconnect
        ])
        .setup(|app| {
            let service = Arc::new(google::GoogleService::new(app.path().app_data_dir()?)?);
            app.manage(service.clone());
            google::start_sync(service, app.handle().clone());
            position::setup(app.handle(), app.path().app_config_dir()?)?;
            window::show_widget(app.handle())?;
            tray::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if matches!(
                    event,
                    tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
                ) {
                    if let Some(position) =
                        window.app_handle().try_state::<position::PositionHandle>()
                    {
                        position.request_restore();
                    }
                }
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if window.hide().is_ok() {
                        api.prevent_close();
                    }
                }
            }
        })
        .run(tauri::generate_context!());
    if let Err(error) = result {
        eprintln!("ClassDock 启动失败：{error}");
    }
}
