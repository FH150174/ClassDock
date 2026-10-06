import { Database, RefreshCw } from "lucide-react";
import { useCalendarStore } from "../stores/calendarStore";

export function SyncStatus() {
  const { snapshot, syncState, refresh } = useCalendarStore();
  return (
    <footer className="sync-footer">
      <span>
        <Database size={12} aria-hidden="true" />
        {snapshot?.source === "mock"
          ? "示例课程 · 未连接 Google"
          : "Google Calendar"}
      </span>
      <button
        onClick={() => void refresh()}
        disabled={syncState === "syncing"}
        title="重新加载示例课程"
      >
        <RefreshCw
          size={12}
          className={syncState === "syncing" ? "spin" : ""}
        />
        {syncState === "syncing"
          ? "加载中"
          : syncState === "error"
            ? "重试"
            : "重新加载"}
      </button>
    </footer>
  );
}
