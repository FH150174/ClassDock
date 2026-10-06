import type { CalendarSnapshot } from "../types/calendar";
import { mockSnapshot } from "./mockCalendarService";
import { localSnapshot } from "./localCalendarService";
import { useLocalCalendarStore } from "../stores/localCalendarStore";

// 本地导入与示例使用相同模型；后续 Google Provider 通过 Rust 读取账户数据。
export interface CalendarProvider {
  load(): Promise<CalendarSnapshot>;
}
export const calendarService: CalendarProvider = {
  async load() {
    useLocalCalendarStore.getState().reload();
    const data = useLocalCalendarStore.getState();
    if (data.readError) throw new Error(data.readError);
    return data.mode === "local" ? localSnapshot(data) : mockSnapshot();
  },
};
