//! 在独立窗口中模拟拖动与唤醒，不让测试电脑实际进入休眠。
use std::{
    path::PathBuf,
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, PhysicalPosition};
#[path = "../src/position.rs"]
mod position;
#[path = "../src/window.rs"]
mod window;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    SendMessageW, PBT_APMRESUMEAUTOMATIC, WM_ENTERSIZEMOVE, WM_EXITSIZEMOVE, WM_POWERBROADCAST,
};
fn wait_position(
    window: &tauri::WebviewWindow,
    expected: PhysicalPosition<i32>,
) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(3);
    while window.outer_position().map_err(|e| e.to_string())? != expected {
        if Instant::now() >= deadline {
            return Err("等待窗口移动完成超时".into());
        }
        thread::sleep(Duration::from_millis(30));
    }
    Ok(())
}
fn main() {
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/position-smoke");
    let restore_only = std::env::args().any(|a| a == "--restore");
    let quick_exit = std::env::args().any(|a| a == "--quick-exit");
    if !restore_only {
        let file = directory.join("widget-position.json");
        if file.exists() {
            std::fs::remove_file(file).expect("清理上次测试位置");
        }
    }
    thread::spawn(|| {
        thread::sleep(Duration::from_secs(45));
        eprintln!("位置测试超时");
        std::process::exit(1);
    });
    tauri::Builder::default()
        .plugin(position::init())
        .invoke_handler(tauri::generate_handler![
            window::open_settings,
            window::set_widget_top
        ])
        .setup(move |app| {
            let main = app.get_webview_window("main").unwrap();
            position::setup(app.handle(), directory.clone())?;
            window::show_widget(app.handle())?;
            let handle = app.handle().clone();
            thread::spawn(move || {
                let result = (|| -> Result<(), String> {
                    let expected = PhysicalPosition::new(120, 90);
                    let saved = directory.join("widget-position.json");
                    if !restore_only {
                        let hwnd = main.hwnd().map_err(|e| e.to_string())?.0;
                        // 用同样的原生消息边界模拟一次已完成的拖动。
                        unsafe {
                            SendMessageW(hwnd, WM_ENTERSIZEMOVE, 0, 0);
                        }
                        main.set_position(expected).map_err(|e| e.to_string())?;
                        // Tauri 跨线程设置会入队，等真实移动完成再发送拖动结束。
                        wait_position(&main, expected)?;
                        unsafe {
                            SendMessageW(hwnd, WM_EXITSIZEMOVE, 0, 0);
                        }
                        if quick_exit {
                            return Ok(());
                        }
                        let deadline = Instant::now() + Duration::from_secs(3);
                        let saved_matches = || {
                            std::fs::read(&saved)
                                .ok()
                                .and_then(|bytes| {
                                    serde_json::from_slice::<serde_json::Value>(&bytes).ok()
                                })
                                .is_some_and(|value| value["x"] == 120 && value["y"] == 90)
                        };
                        while !saved_matches() && Instant::now() < deadline {
                            thread::sleep(Duration::from_millis(30));
                        }
                        if !saved_matches() {
                            return Err("拖动结束后没有立即保存固定坐标".into());
                        }
                        main.center().map_err(|e| e.to_string())?;
                        let deadline = Instant::now() + Duration::from_secs(3);
                        while main.outer_position().map_err(|e| e.to_string())? == expected {
                            if Instant::now() >= deadline {
                                return Err("模拟系统移动未完成".into());
                            }
                            thread::sleep(Duration::from_millis(30));
                        }
                        unsafe {
                            SendMessageW(
                                hwnd,
                                WM_POWERBROADCAST,
                                PBT_APMRESUMEAUTOMATIC as usize,
                                0,
                            );
                        }
                    }
                    let deadline = Instant::now() + Duration::from_secs(12);
                    while main.outer_position().map_err(|e| e.to_string())? != expected {
                        if Instant::now() > deadline {
                            eprintln!(
                                "实际坐标={:?}，尺寸={:?}，显示器={:?}",
                                main.outer_position(),
                                main.outer_size(),
                                main.available_monitors()
                            );
                            return Err(format!(
                                "{}未恢复固定坐标",
                                if restore_only { "重启" } else { "唤醒" }
                            ));
                        }
                        thread::sleep(Duration::from_millis(30));
                    }
                    if !restore_only {
                        main.hide().map_err(|e| e.to_string())?;
                        main.center().map_err(|e| e.to_string())?;
                        window::show_widget(&handle).map_err(|e| e.to_string())?;
                        wait_position(&main, expected)?;
                        if main.outer_position().map_err(|e| e.to_string())? != expected {
                            return Err("托盘显示未恢复固定坐标".into());
                        }
                    }
                    let value: serde_json::Value =
                        serde_json::from_slice(&std::fs::read(saved).map_err(|e| e.to_string())?)
                            .map_err(|e| e.to_string())?;
                    if value["x"] != 120 || value["y"] != 90 {
                        return Err("系统临时移动覆盖了固定坐标".into());
                    }
                    Ok(())
                })();
                match result {
                    Ok(()) => {
                        println!("窗口位置原生回归通过（重启模式：{restore_only}）");
                        handle.exit(0);
                    }
                    Err(e) => {
                        eprintln!("位置测试失败：{e}");
                        std::process::exit(1);
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动位置回归窗口");
}
