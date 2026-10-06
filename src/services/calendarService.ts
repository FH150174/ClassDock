import { googleService, mergeGoogleCourses } from "./googleCalendarService";
import type { CalendarSnapshot } from "../types/calendar";
import { mockSnapshot } from "./mockCalendarService";
import { localSnapshot } from "./localCalendarService";
import { useLocalCalendarStore } from "../stores/localCalendarStore";

// Google 由 Rust 安全读取并缓存，前端与本地课程合并使用同一模型。
export interface CalendarProvider {
  load(force?: boolean): Promise<CalendarSnapshot>;
}
export const calendarService: CalendarProvider = {
  async load(force = false) {
    useLocalCalendarStore.getState().reload();
    const data = useLocalCalendarStore.getState();
    if (data.readError) throw new Error(data.readError);
    if (data.mode === "mock") return mockSnapshot();
    return mergeGoogleCourses(localSnapshot(data), await googleService.load(force));
  },
};
