import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalendarSnapshot } from "../types/calendar";
vi.mock("../services/calendarService", () => ({
  calendarService: { load: vi.fn() },
}));
import { calendarService } from "../services/calendarService";
import { useCalendarStore } from "./calendarStore";
const snapshot = (id: string): CalendarSnapshot => ({
  courses: [],
  calendars: [],
  selectedCalendarId: id,
  lastSyncTime: "2026-10-07T00:00:00Z",
  source: "google",
});
afterEach(() => {
  vi.clearAllMocks();
  useCalendarStore.setState({ snapshot: null, syncState: "idle", error: null });
});
describe("并发课表刷新", () => {
  it("同步中换日历会排队再读，旧结果不覆盖新结果", async () => {
    let resolve!: (value: CalendarSnapshot) => void;
    vi.mocked(calendarService.load)
      .mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      )
      .mockResolvedValueOnce(snapshot("new"));
    const first = useCalendarStore.getState().refresh();
    const second = useCalendarStore.getState().refresh(true);
    expect(second).toBe(first);
    resolve(snapshot("old"));
    await second;
    expect(calendarService.load).toHaveBeenNthCalledWith(2, true);
    expect(useCalendarStore.getState().snapshot?.selectedCalendarId).toBe(
      "new",
    );
  });
  it("刷新失败显示错误并保留已有快照", async () => {
    useCalendarStore.setState({ snapshot: snapshot("saved") });
    vi.mocked(calendarService.load).mockRejectedValueOnce(
      new Error("网络失败"),
    );
    await useCalendarStore.getState().refresh();
    expect(useCalendarStore.getState().error).toBe("网络失败");
    expect(useCalendarStore.getState().snapshot?.selectedCalendarId).toBe(
      "saved",
    );
    expect(useCalendarStore.getState().syncState).toBe("error");
  });
});
