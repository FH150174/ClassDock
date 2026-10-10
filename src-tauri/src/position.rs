//! 用户拖动的位置独立保存；系统恢复、显示器重排和临时移动不修改固定坐标。
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, PhysicalPosition};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Point {
    x: i32,
    y: i32,
}
#[derive(Serialize, Deserialize)]
struct SavedPosition {
    version: u8,
    x: i32,
    y: i32,
}
#[derive(Clone, Copy)]
struct Area {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}
#[derive(Default)]
struct Anchor {
    point: Option<Point>,
    dragging: bool,
}
impl Anchor {
    fn begin_drag(&mut self) {
        self.dragging = true;
    }
    fn end_drag(&mut self, point: Option<Point>) -> bool {
        let was_dragging = std::mem::replace(&mut self.dragging, false);
        if was_dragging {
            if let Some(point) = point.filter(valid_point) {
                self.point = Some(point);
                return true;
            }
        }
        false
    }
    fn resume(&mut self) {
        self.dragging = false;
    }
}
enum Signal {
    Save,
    Restore,
    Stop,
}
#[derive(Clone)]
pub struct PositionHandle {
    anchor: Arc<Mutex<Anchor>>,
    sender: mpsc::Sender<Signal>,
    directory: Arc<PathBuf>,
    save_lock: Arc<Mutex<()>>,
}
impl PositionHandle {
    fn persist(&self) -> io::Result<()> {
        // 先串行化写入，再读取最新坐标，防止退出保存被旧队列覆盖。
        let _guard = self
            .save_lock
            .lock()
            .map_err(|_| io::Error::other("窗口位置写入不可用"))?;
        let point = self
            .anchor
            .lock()
            .map_err(|_| io::Error::other("窗口位置状态不可用"))?
            .point;
        if let Some(point) = point {
            save_position(&self.directory, point)?;
        }
        Ok(())
    }
    pub fn request_restore(&self) {
        let _ = self.sender.send(Signal::Restore);
    }
}
fn valid_point(point: &Point) -> bool {
    // Windows 最小化使用 -32000 哨兵；保留正常的多显示器负坐标。
    point.x != -32000
        && point.y != -32000
        && point.x.abs_diff(0) <= 200_000
        && point.y.abs_diff(0) <= 200_000
}
fn read_json(path: &Path) -> io::Result<Option<serde_json::Value>> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    let mut bytes = Vec::new();
    file.take(8193).read_to_end(&mut bytes)?;
    if bytes.len() > 8192 {
        return Err(io::Error::other("窗口位置文件过大"));
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(io::Error::other)
}
fn load_position(directory: &Path) -> io::Result<Option<Point>> {
    if let Some(value) = read_json(&directory.join("widget-position.json"))? {
        let saved: SavedPosition = serde_json::from_value(value).map_err(io::Error::other)?;
        let point = Point {
            x: saved.x,
            y: saved.y,
        };
        if saved.version != 1 || !valid_point(&point) {
            return Err(io::Error::other("窗口位置记录无效"));
        }
        return Ok(Some(point));
    }
    // 迁移旧版位置。旧插件仅保存 POSITION 时尺寸为零，坐标仍然有效。
    let Some(value) = read_json(&directory.join(".window-state.json"))? else {
        return Ok(None);
    };
    Ok(value.get("main").and_then(|main| {
        let point = Point {
            x: i32::try_from(main.get("x")?.as_i64()?).ok()?,
            y: i32::try_from(main.get("y")?.as_i64()?).ok()?,
        };
        valid_point(&point).then_some(point)
    }))
}
fn save_position(directory: &Path, point: Point) -> io::Result<()> {
    fs::create_dir_all(directory)?;
    let bytes = serde_json::to_vec(&SavedPosition {
        version: 1,
        x: point.x,
        y: point.y,
    })
    .map_err(io::Error::other)?;
    let temporary = directory.join("widget-position.tmp");
    fs::write(&temporary, bytes)?;
    fs::rename(temporary, directory.join("widget-position.json"))
}
fn visible_position(point: Point, size: (u32, u32), areas: &[Area]) -> Option<Point> {
    let clamp = |area: &Area| Point {
        x: (point.x as i64).clamp(
            area.x as i64,
            area.x as i64 + area.width.saturating_sub(size.0) as i64,
        ) as i32,
        y: (point.y as i64).clamp(
            area.y as i64,
            area.y as i64 + area.height.saturating_sub(size.1) as i64,
        ) as i32,
    };
    // 优先留在用户选择的显示器，缺失时放到最近的可见工作区，不覆盖原记录。
    areas
        .iter()
        .filter(|a| a.width > 0 && a.height > 0)
        .min_by_key(|a| {
            let inside = point.x as i64 >= a.x as i64
                && (point.x as i64) < a.x as i64 + a.width as i64
                && point.y as i64 >= a.y as i64
                && (point.y as i64) < a.y as i64 + a.height as i64;
            let candidate = clamp(a);
            (
                !inside,
                candidate.x.abs_diff(point.x) as u64 + candidate.y.abs_diff(point.y) as u64,
            )
        })
        .map(clamp)
}
pub fn restore(app: &AppHandle) -> tauri::Result<()> {
    let Some(handle) = app.try_state::<PositionHandle>() else {
        return Ok(());
    };
    let anchor = handle
        .anchor
        .lock()
        .map_err(|_| tauri::Error::Io(io::Error::other("窗口位置状态不可用")))?;
    if anchor.dragging {
        return Ok(());
    }
    let Some(point) = anchor.point else {
        return Ok(());
    };
    drop(anchor);
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    if window.is_minimized()? {
        return Ok(());
    }
    let size = window.outer_size()?;
    let areas: Vec<_> = window
        .available_monitors()?
        .iter()
        .map(|m| {
            let area = m.work_area();
            Area {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            }
        })
        .collect();
    if let Some(target) = visible_position(point, (size.width, size.height), &areas) {
        let current = window.outer_position()?;
        if current.x != target.x || current.y != target.y {
            window.set_position(PhysicalPosition::new(target.x, target.y))?;
        }
    }
    Ok(())
}
pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("widget-position")
        .on_event(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(handle) = app.try_state::<PositionHandle>() {
                    if let Err(e) = handle.persist() {
                        eprintln!("退出时保存课程表固定位置失败：{e}");
                    }
                }
            }
        })
        .build()
}
pub fn setup(app: &AppHandle, directory: PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    let point = match load_position(&directory) {
        Ok(point) => point,
        Err(e) => {
            eprintln!("读取课程表固定位置失败：{e}");
            None
        }
    };
    let point = point.or_else(|| {
        let current = app.get_webview_window("main")?.outer_position().ok()?;
        let point = Point {
            x: current.x,
            y: current.y,
        };
        valid_point(&point).then_some(point)
    });
    let (sender, receiver) = mpsc::channel();
    let handle = PositionHandle {
        anchor: Arc::new(Mutex::new(Anchor {
            point,
            dragging: false,
        })),
        sender,
        directory: Arc::new(directory),
        save_lock: Arc::new(Mutex::new(())),
    };
    app.manage(handle.clone());
    #[cfg(windows)]
    native::install(app, handle.clone())?;
    restore(app)?;
    let app = app.clone();
    let persistence = handle.clone();
    thread::spawn(move || {
        let mut next_restore: Option<Instant> = None;
        let mut attempts = 0;
        loop {
            let signal = match next_restore {
                Some(next) => receiver.recv_timeout(next.saturating_duration_since(Instant::now())),
                None => receiver
                    .recv()
                    .map_err(|_| mpsc::RecvTimeoutError::Disconnected),
            };
            match signal {
                Ok(Signal::Save) => {
                    next_restore = None;
                    if let Err(e) = persistence.persist() {
                        eprintln!("保存课程表固定位置失败：{e}");
                    }
                }
                Ok(Signal::Restore) => {
                    attempts = 8;
                    next_restore = Some(Instant::now() + Duration::from_millis(700));
                }
                Ok(Signal::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    let target = app.clone();
                    if app
                        .run_on_main_thread(move || {
                            if let Err(e) = restore(&target) {
                                eprintln!("恢复课程表固定位置失败：{e}");
                            }
                        })
                        .is_err()
                    {
                        break;
                    }
                    attempts -= 1;
                    next_restore = (attempts > 0).then(|| Instant::now() + Duration::from_secs(1));
                }
            }
        }
    });
    if point.is_some() {
        let _ = handle.sender.send(Signal::Save);
    }
    handle.request_restore();
    Ok(())
}

#[cfg(windows)]
mod native {
    use super::*;
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
        UI::{
            Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{
                GetWindowRect, IsIconic, IsZoomed, PBT_APMRESUMEAUTOMATIC, PBT_APMRESUMECRITICAL,
                PBT_APMRESUMESUSPEND, WM_DISPLAYCHANGE, WM_DPICHANGED, WM_ENTERSIZEMOVE,
                WM_EXITSIZEMOVE, WM_NCDESTROY, WM_POWERBROADCAST,
            },
        },
    };
    const SUBCLASS_ID: usize = 0x43444F43;
    pub fn install(
        app: &AppHandle,
        handle: PositionHandle,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| io::Error::other("课程表窗口不存在"))?;
        let hwnd = window.hwnd()?.0;
        let context = Box::into_raw(Box::new(handle));
        // setup 在窗口所属线程运行；原生回调持有 Box，直到 WM_NCDESTROY 释放一次。
        if unsafe { SetWindowSubclass(hwnd, Some(subclass), SUBCLASS_ID, context as usize) } == 0 {
            unsafe {
                drop(Box::from_raw(context));
            }
            return Err(io::Error::other("无法安装窗口位置恢复监听").into());
        }
        Ok(())
    }
    unsafe extern "system" fn subclass(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        id: usize,
        data: usize,
    ) -> LRESULT {
        // data 仅由 install 创建，在本窗口线程的销毁通知前一直有效。
        let handle = unsafe { &*(data as *const PositionHandle) };
        match message {
            WM_ENTERSIZEMOVE => {
                if let Ok(mut anchor) = handle.anchor.lock() {
                    anchor.begin_drag();
                }
            }
            WM_EXITSIZEMOVE => {
                let mut rect = RECT {
                    left: 0,
                    top: 0,
                    right: 0,
                    bottom: 0,
                };
                let valid = unsafe {
                    IsIconic(hwnd) == 0
                        && IsZoomed(hwnd) == 0
                        && GetWindowRect(hwnd, &mut rect) != 0
                };
                if let Ok(mut anchor) = handle.anchor.lock() {
                    if anchor.end_drag(valid.then_some(Point {
                        x: rect.left,
                        y: rect.top,
                    })) {
                        let _ = handle.sender.send(Signal::Save);
                    }
                }
            }
            WM_POWERBROADCAST
                if [
                    PBT_APMRESUMEAUTOMATIC,
                    PBT_APMRESUMESUSPEND,
                    PBT_APMRESUMECRITICAL,
                ]
                .contains(&(wparam as u32)) =>
            {
                if let Ok(mut anchor) = handle.anchor.lock() {
                    anchor.resume();
                }
                handle.request_restore();
            }
            WM_DISPLAYCHANGE | WM_DPICHANGED => handle.request_restore(),
            WM_NCDESTROY => {
                let _ = handle.sender.send(Signal::Stop);
                // 移除回调后释放上下文；继续向下传递销毁消息，不访问已释放的 data。
                unsafe {
                    RemoveWindowSubclass(hwnd, Some(subclass), id);
                    drop(Box::from_raw(data as *mut PositionHandle));
                }
            }
            _ => {}
        }
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_completed_user_drag_changes_anchor() {
        let fixed = Point { x: 1400, y: 80 };
        let mut anchor = Anchor {
            point: Some(fixed),
            dragging: false,
        };
        assert!(!anchor.end_drag(Some(Point { x: 800, y: 200 })));
        assert_eq!(anchor.point, Some(fixed));
        anchor.begin_drag();
        anchor.resume();
        assert!(!anchor.end_drag(Some(Point { x: 800, y: 200 })));
        assert_eq!(anchor.point, Some(fixed));
        anchor.begin_drag();
        assert!(anchor.end_drag(Some(Point { x: 1450, y: 110 })));
        assert_eq!(anchor.point, Some(Point { x: 1450, y: 110 }));
    }
    #[test]
    fn minimized_and_invalid_positions_never_replace_anchor() {
        let fixed = Point { x: -1800, y: 90 };
        let mut anchor = Anchor {
            point: Some(fixed),
            dragging: false,
        };
        for invalid in [
            Some(Point {
                x: -32000,
                y: -32000,
            }),
            Some(Point { x: i32::MAX, y: 0 }),
            None,
        ] {
            anchor.begin_drag();
            assert!(!anchor.end_drag(invalid));
            assert_eq!(anchor.point, Some(fixed));
        }
    }
    #[test]
    fn visible_position_preserves_negative_monitors_and_handles_disconnect() {
        let point = Point { x: -1800, y: 90 };
        let areas = [
            Area {
                x: 0,
                y: 0,
                width: 1920,
                height: 1040,
            },
            Area {
                x: -1920,
                y: 0,
                width: 1920,
                height: 1040,
            },
        ];
        assert_eq!(visible_position(point, (360, 620), &areas), Some(point));
        assert_eq!(
            visible_position(point, (360, 620), &areas[..1]),
            Some(Point { x: 0, y: 90 })
        );
        assert_eq!(visible_position(point, (360, 620), &[]), None);
        assert_eq!(
            visible_position(Point { x: 1800, y: 900 }, (360, 620), &areas),
            Some(Point { x: 1560, y: 420 })
        );
    }
    #[test]
    fn old_zero_size_position_migrates_and_new_position_takes_precedence() {
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.tmp")
            .join(format!("position-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let old_file = directory.join(".window-state.json");
        fs::write(
            &old_file,
            br#"{"main":{"x":-1800,"y":90,"width":0,"height":0}}"#,
        )
        .unwrap();
        assert_eq!(
            load_position(&directory).unwrap(),
            Some(Point { x: -1800, y: 90 })
        );
        save_position(&directory, Point { x: 120, y: 100 }).unwrap();
        save_position(&directory, Point { x: 150, y: 130 }).unwrap();
        assert_eq!(
            load_position(&directory).unwrap(),
            Some(Point { x: 150, y: 130 })
        );
        fs::remove_file(directory.join("widget-position.json")).unwrap();
        fs::remove_file(old_file).unwrap();
        fs::remove_dir(directory).unwrap();
    }
}
