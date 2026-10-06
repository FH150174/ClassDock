import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { GOOGLE_EVENT } from "./services/googleCalendarService";
import {
  useLocalCalendarStore,
  LOCAL_CALENDAR_KEY,
} from "./stores/localCalendarStore";
import { useCalendarStore } from "./stores/calendarStore";
import { useEffect, useState } from "react";
import { useSettingsStore } from "./stores/settingsStore";
import { applyWindowSettings } from "./services/desktopService";
import { WidgetPage } from "./pages/WidgetPage";
import { SettingsPage } from "./pages/SettingsPage";

export default function App() {
  const settingsWindow = new URLSearchParams(window.location.search).has(
    "settings",
  );
  const { settings } = useSettingsStore();
  const [nativeError, setNativeError] = useState<string | null>(null);
  useEffect(() => {
    document.documentElement.dataset.surface = settingsWindow
      ? "settings"
      : "widget";
  }, [settingsWindow]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        settings.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : settings.theme;
    };
    apply();
    media.addEventListener("change", apply);
    document.documentElement.style.setProperty(
      "--panel-opacity",
      String(settings.opacity / 100),
    );
    return () => media.removeEventListener("change", apply);
  }, [settings]);
  useEffect(() => {
    void applyWindowSettings(settings.alwaysOnTop)
      .then(() => setNativeError(null))
      .catch(() => setNativeError("置顶设置未能应用，请重新切换此选项。"));
  }, [settings.alwaysOnTop]);
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key === LOCAL_CALENDAR_KEY || event.key === null) {
        useLocalCalendarStore.getState().reload();
        void useCalendarStore.getState().refresh();
      }
      if (event.key === "classdock-settings" || event.key === null)
        void useSettingsStore.persist.rehydrate();
    };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen(GOOGLE_EVENT, () => void useCalendarStore.getState().refresh())
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch(() => {
        if (!disposed)
          setNativeError("Google 同步通知未能连接，请重新打开应用。");
      });
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  return (
    <>
      {nativeError && (
        <p className="error-note" role="alert">
          {nativeError}
        </p>
      )}
      {settingsWindow ? <SettingsPage /> : <WidgetPage />}
    </>
  );
}
