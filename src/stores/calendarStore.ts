import { create } from "zustand";
import type { CalendarSnapshot, SyncState } from "../types/calendar";
import { calendarService } from "../services/calendarService";
interface CalendarState {
  snapshot: CalendarSnapshot | null;
  syncState: SyncState;
  error: string | null;
  refresh: (force?: boolean) => Promise<void>;
}
let running: Promise<void> | null = null;
let requested = false;
let forceRequested = false;
export const useCalendarStore = create<CalendarState>((set) => ({
  snapshot: null,
  syncState: "idle",
  error: null,
  refresh: (force = false) => {
    requested = true;
    forceRequested ||= force;
    if (running) return running;
    running = (async () => {
      // 同步期间到达的设置或账号变更必须再读一次，防止晚到结果覆盖新课表。
      do {
        requested = false;
        const nextForce = forceRequested;
        forceRequested = false;
        set({ syncState: "syncing", error: null });
        try {
          const snapshot = await calendarService.load(nextForce);
          if (!requested) set({ snapshot, syncState: "idle" });
        } catch (error) {
          if (!requested)
            set({
              syncState: "error",
              error:
                error instanceof Error
                  ? error.message
                  : "课程加载失败，请重试。",
            });
        }
      } while (requested);
    })().finally(() => {
      running = null;
    });
    return running;
  },
}));
