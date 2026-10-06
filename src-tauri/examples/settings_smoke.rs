//! Windows 设置窗口生命周期回归测试，独立于正式应用入口。
use std::{
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, State};

#[path = "../src/google.rs"]
mod google;
#[path = "../src/window.rs"]
mod window;

struct RenderReport(Mutex<mpsc::Sender<String>>);

#[tauri::command]
fn report_settings(text: String, state: State<'_, RenderReport>) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .send(text)
        .map_err(|e| e.to_string())
}

fn main() {
    // 即使窗口线程再次死锁，也要让独立测试在限定时间内失败退出。
    thread::spawn(|| {
        thread::sleep(Duration::from_secs(60));
        eprintln!("原生设置测试超过 60 秒，可能发生窗口线程死锁");
        std::process::exit(1);
    });
    let (loaded_tx, loaded_rx) = mpsc::channel();
    let (render_tx, render_rx) = mpsc::channel();
    tauri::Builder::default()
        .manage(RenderReport(Mutex::new(render_tx)))
        .invoke_handler(tauri::generate_handler![
            window::open_settings,
            window::set_widget_top,
            google::google_status, google::google_configure, google::google_connect, google::google_cancel,
            google::google_calendars, google::google_select, google::google_load, google::google_disconnect,
            report_settings
        ])
        .on_page_load(move |webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                let _ = loaded_tx.send(webview.label().to_string());
            }
        })
        .setup(move |app| {
            let service = Arc::new(google::GoogleService::new(std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/smoke-google"))?);
            google::start_sync(service.clone(), app.handle().clone());
            app.manage(service);
            window::show_widget(app.handle())?;
            app.get_webview_window("main").unwrap().hide()?;
            let handle = app.handle().clone();
            thread::spawn(move || {
                let result = (|| -> Result<(), String> {
                    let label = loaded_rx.recv_timeout(Duration::from_secs(15))
                        .map_err(|e| format!("测试主页面未加载：{e}"))?;
                    if label != "main" { return Err(format!("主页面标签错误：{label}")); }
                    for round in 1..=2 {
                        handle.get_webview_window("main").ok_or("主窗口不存在")?
                            .eval("window.__TAURI_INTERNALS__.invoke('open_settings')")
                            .map_err(|e| e.to_string())?;
                        loaded_rx.recv_timeout(Duration::from_secs(15))
                            .map_err(|e| format!("第 {round} 次设置页未加载：{e}"))?;
                        let settings = handle.get_webview_window("settings").ok_or("设置窗口不存在")?;
                        // 只读取真实 React 页面，报告命令仅注册在测试程序中。
                        settings.eval(r#"
                            (() => {
                                let attempts = 0;
                                const check = () => {
                                    const page = document.querySelector('.settings-page');
                                    if (page) {
                                        const config = page.querySelector(".google-sources details");
                                        if (config) config.open = true;
                                        window.__TAURI_INTERNALS__.invoke('report_settings', { text: page.innerText });
                                    } else if (++attempts < 100) {
                                        setTimeout(check, 50);
                                    }
                                };
                                check();
                            })();
                        "#).map_err(|e| e.to_string())?;
                        let text = render_rx.recv_timeout(Duration::from_secs(10))
                            .map_err(|e| format!("第 {round} 次 React 设置页未渲染：{e}"))?;
                        if !text.contains("让课表，适合你") || !text.contains("课程来源") || !text.contains("选择课程文件") || !text.contains("始终置顶") || !text.contains("Google 日历") || !text.contains("登录 Google") || !text.contains("导入桌面 OAuth JSON") || !text.contains(env!("CARGO_PKG_VERSION")) {
                            return Err(format!("第 {round} 次设置内容不完整：{text}"));
                        }
                        // 已打开时再次调用必须复用窗口，不能创建重复窗口。
                        tauri::async_runtime::block_on(window::open_settings(handle.clone()))?;
                        if handle.webview_windows().len() != 2 {
                            return Err("出现重复窗口".into());
                        }
                        settings.close().map_err(|e| e.to_string())?;
                        let deadline = Instant::now() + Duration::from_secs(5);
                        while handle.get_webview_window("settings").is_some() {
                            if Instant::now() >= deadline {
                                return Err(format!("第 {round} 次设置窗口无法关闭"));
                            }
                            thread::sleep(Duration::from_millis(20));
                        }
                        println!("第 {round} 次：设置页渲染、复用、关闭通过");
                    }
                    Ok(())
                })();
                match result {
                    Ok(()) => { println!("设置窗口原生集成测试通过"); handle.exit(0); }
                    Err(error) => { eprintln!("设置窗口原生集成测试失败：{error}"); handle.exit(1); }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("无法启动原生集成测试");
}
