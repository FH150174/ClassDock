import { isTauri, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

export async function applyWindowSettings(alwaysOnTop: boolean) {
  if (isTauri()) await invoke("set_widget_top", { enabled: alwaysOnTop });
}
export async function hideWindow() {
  if (isTauri()) await getCurrentWindow().hide();
}
export async function openSettings() {
  if (isTauri()) await invoke("open_settings");
}
export async function fitWindow(height: number) {
  if (isTauri() && getCurrentWindow().label === "main") {
    await getCurrentWindow().setSize(
      new LogicalSize(360, Math.max(520, Math.min(780, height))),
    );
  }
}
