import type { CalendarSnapshot } from "../types/calendar";
import { mockSnapshot } from "./mockCalendarService";

// 第二阶段通过 Rust 命令实现 Google Provider，UI 不接触 OAuth Token。
export interface CalendarProvider {
  load(): Promise<CalendarSnapshot>;
}
export const calendarService: CalendarProvider = {
  async load() {
    return mockSnapshot();
  },
};
