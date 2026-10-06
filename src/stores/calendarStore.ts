import { create } from "zustand";
import type { CalendarSnapshot, SyncState } from "../types/calendar";
import { calendarService } from "../services/calendarService";

interface CalendarState {
  snapshot: CalendarSnapshot | null;
  syncState: SyncState;
  error: string | null;
  refresh: () => Promise<void>;
}
export const useCalendarStore = create<CalendarState>((set, get) => ({
  snapshot: null,
  syncState: "idle",
  error: null,
  refresh: async () => {
    if (get().syncState === "syncing") return;
    set({ syncState: "syncing", error: null });
    try {
      set({ snapshot: await calendarService.load(), syncState: "idle" });
    } catch {
      set({ syncState: "error", error: "课程加载失败，请重试。" });
    }
  },
}));
