import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Settings2,
  ChevronDown,
  Minimize2,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useClock } from "../hooks/useClock";
import { useAutoHideScrollbar } from "../hooks/useAutoHideScrollbar";
import { useCalendarStore } from "../stores/calendarStore";
import { useSettingsStore } from "../stores/settingsStore";
import {
  fitWindow,
  hideWindow,
  openSettings,
} from "../services/desktopService";
import { NextClass } from "../components/NextClass";
import { TodaySchedule } from "../components/TodaySchedule";
import { WeekSchedule } from "../components/WeekSchedule";
import { SyncStatus } from "../components/SyncStatus";
import { SettingsPage } from "./SettingsPage";

export function WidgetPage() {
  const now = useClock();
  const { snapshot, syncState, error, refresh } = useCalendarStore();
  const locked = useSettingsStore((state) => state.settings.locked);
  const [view, setView] = useState<"today" | "week">("today");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [windowError, setWindowError] = useState<string | null>(null);
  const shell = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const scrollArea = useRef<HTMLElement>(null);
  useAutoHideScrollbar(scrollArea, !settingsOpen);
  const dateKey = now.toISODate();
  useEffect(() => {
    void refresh();
  }, [refresh, dateKey]);
  useEffect(() => {
    if (!isTauri()) return;
    const pending = listen<string>("widget-action", (event) => {
      if (event.payload === "refresh") void refresh(true);
      if (event.payload === "today" || event.payload === "week")
        setView(event.payload);
    });
    return () => {
      void pending.then((unlisten) => unlisten());
    };
  }, [refresh]);
  useEffect(() => {
    if (!shell.current || !content.current) return;
    const element = shell.current;
    const body = content.current;
    const header = element.querySelector<HTMLElement>(".widget-header");
    const footer = element.querySelector<HTMLElement>(".sync-footer");
    const observer = new ResizeObserver(() => {
      // 测量未被滚动容器截断的内容，避免窗口尺寸限制产生页面级滚动条。
      const height =
        body.getBoundingClientRect().height +
        (header?.getBoundingClientRect().height ?? 0) +
        (footer?.getBoundingClientRect().height ?? 0) +
        18;
      void fitWindow(Math.ceil(height)).catch(() =>
        setWindowError("窗口尺寸调整失败，可继续查看课程。"),
      );
    });
    observer.observe(body);
    if (header) observer.observe(header);
    if (footer) observer.observe(footer);
    return () => observer.disconnect();
  }, [settingsOpen]);
  const desktopAction = (action: Promise<void>) => {
    void action.catch(() => setWindowError("窗口操作失败，请重试。"));
  };
  if (settingsOpen)
    return <SettingsPage onBack={() => setSettingsOpen(false)} />;
  return (
    <div className="widget" ref={shell}>
      <header
        className={`widget-header drag-region ${locked ? "locked" : ""}`}
        data-tauri-drag-region={locked ? "false" : "deep"}
        title={
          locked ? "位置已锁定，可在设置中解锁" : "按住顶部或日期区域拖动窗口"
        }
      >
        <div className="brand">
          <span className="brand-icon">
            <CalendarDays size={16} />
          </span>
          <span>ClassDock</span>
          <span className="brand-dot" />
          {locked && <LockKeyhole size={11} aria-label="位置已锁定" />}
        </div>
        <div className="toolbar" data-tauri-drag-region="false">
          <button
            className="icon-button"
            onClick={() => void refresh(true)}
            disabled={syncState === "syncing"}
            aria-label="重新加载课程"
          >
            <RefreshCw
              size={14}
              className={syncState === "syncing" ? "spin" : ""}
            />
          </button>
          <button
            className="icon-button"
            onClick={() =>
              isTauri() ? desktopAction(openSettings()) : setSettingsOpen(true)
            }
            aria-label="打开设置"
          >
            <Settings2 size={16} />
          </button>
          {isTauri() && (
            <button
              className="icon-button"
              onClick={() => desktopAction(hideWindow())}
              aria-label="收起到托盘"
            >
              <Minimize2 size={15} />
            </button>
          )}
        </div>
      </header>
      <main
        className="widget-main auto-hide-scroll"
        ref={scrollArea}
        tabIndex={0}
        aria-label="课程内容"
      >
        <div className="widget-content" ref={content}>
          <section
            className={`date-heading drag-region ${locked ? "locked" : ""}`}
            data-tauri-drag-region={locked ? "false" : "deep"}
            title={locked ? "位置已锁定，可在设置中解锁" : "按住这里拖动窗口"}
          >
            <div>
              <p className="eyebrow">你的每一天，有条不紊</p>
              <h1>
                {now.toFormat("M")}
                <span>月</span>
                {now.toFormat("d")}
                <span>日</span>
              </h1>
              <p className="date-detail">
                {now.setLocale("zh-CN").toFormat("cccc")}
                <span>·</span>
                {now.toFormat("yyyy")}
              </p>
            </div>
            <div className="date-stamp">
              <span>{now.setLocale("en").toFormat("MMM").toUpperCase()}</span>
              <strong>{now.toFormat("dd")}</strong>
            </div>
          </section>
          <NextClass courses={snapshot?.courses ?? []} now={now} />
          <div className="view-tabs" role="group" aria-label="课程显示范围">
            <button
              aria-pressed={view === "today"}
              className={view === "today" ? "active" : ""}
              onClick={() => setView("today")}
            >
              今日课程
            </button>
            <button
              aria-pressed={view === "week"}
              className={view === "week" ? "active" : ""}
              onClick={() => setView("week")}
            >
              本周课程{" "}
              <ChevronDown
                size={12}
                className={view === "week" ? "flipped" : ""}
              />
            </button>
          </div>
          {error || windowError || snapshot?.warning ? (
            <p className="error-note" role="alert">
              {error ?? windowError ?? snapshot?.warning}
            </p>
          ) : null}
          {view === "today" ? (
            <TodaySchedule courses={snapshot?.courses ?? []} now={now} />
          ) : (
            <WeekSchedule courses={snapshot?.courses ?? []} now={now} />
          )}
        </div>
      </main>
      <SyncStatus />
    </div>
  );
}
