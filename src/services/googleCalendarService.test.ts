import { describe, expect, it } from "vitest";
import {
  desktopClientJson,
  mergeGoogleCourses,
  type GooglePayload,
} from "./googleCalendarService";
import type { CalendarSnapshot, GoogleCalendarEvent } from "../types/calendar";
const local: CalendarSnapshot = {
  courses: [],
  calendars: [],
  selectedCalendarId: "local",
  lastSyncTime: "2026-10-07T00:00:00Z",
  source: "local",
};
const event: GoogleCalendarEvent = {
  id: "lesson",
  summary: "数据结构",
  start: { dateTime: "2026-10-07T00:30:00Z" },
  end: { dateTime: "2026-10-07T02:00:00Z" },
};
const payload = (events: GoogleCalendarEvent[] = [event]): GooglePayload => ({
  calendar: {
    id: "class@example.com",
    name: "课程",
    timeZone: "Asia/Shanghai",
    primary: true,
  },
  events,
  lastSyncTime: "2026-10-07T03:00:00Z",
  warning: null,
});
describe("Google 桌面配置", () => {
  it("接受桌面配置，忽略自定义网络端点", () => {
    expect(
      desktopClientJson(
        JSON.stringify({
          installed: {
            client_id: "test.apps.googleusercontent.com",
            client_secret: "fixture",
            token_uri: "http://example.invalid",
          },
        }),
      ),
    ).toEqual({
      clientId: "test.apps.googleusercontent.com",
      clientSecret: "fixture",
    });
  });
  it("拒绝 Web 客户端和错误配置", () => {
    expect(() => desktopClientJson('{"web":{}}')).toThrow("桌面");
    expect(() =>
      desktopClientJson('{"installed":{"client_id":"invalid"}}'),
    ).toThrow("Client ID");
    expect(() =>
      desktopClientJson(
        '{"installed":{"client_id":"test.apps.googleusercontent.com","client_secret":5}}',
      ),
    ).toThrow("密钥");
    expect(() => desktopClientJson("x".repeat(32769))).toThrow("32 KB");
    expect(() => desktopClientJson("{")).toThrow("JSON");
  });
});
describe("Google 与本地课程合并", () => {
  it("未连接保留本地快照", () =>
    expect(mergeGoogleCourses(local, null)).toBe(local));
  it("UTC 时间保留绝对时刻，Google ID 不覆盖本地同名事件", () => {
    const google = mergeGoogleCourses(local, payload());
    const result = mergeGoogleCourses(
      {
        ...local,
        courses: [{ ...google.courses[0], id: "lesson", calendarId: "local" }],
      },
      payload(),
    );
    expect(result.source).toBe("mixed");
    expect(result.courses).toHaveLength(2);
    expect(result.courses.map((c) => c.id)).toContain(
      "google:class@example.com:lesson",
    );
    expect(Date.parse(result.courses[0].startTime)).toBe(
      Date.parse("2026-10-07T00:30:00Z"),
    );
  });
  it("忽略全天、取消和坏事件；保留离线失败说明", () => {
    const data = payload([
      event,
      { ...event, id: "cancel", status: "cancelled" },
      { id: "all", start: { date: "2026-10-07" }, end: { date: "2026-10-08" } },
      { ...event, id: "bad", summary: 42 } as unknown as GoogleCalendarEvent,
      { id: "empty" },
    ]);
    data.warning = { code: "network", message: "无法连接 Google" };
    const result = mergeGoogleCourses(local, data);
    expect(result.courses).toHaveLength(1);
    expect(result.warning).toContain("2 条无效");
    expect(result.warning).toContain("无法连接");
    expect(result.lastSyncTime).toBe(data.lastSyncTime);
  });
  it("拒绝损坏的缓存与超量课程", () => {
    expect(() =>
      mergeGoogleCourses(local, { ...payload(), lastSyncTime: "bad" }),
    ).toThrow("缓存");
    const course = mergeGoogleCourses(local, payload()).courses[0];
    expect(() =>
      mergeGoogleCourses(
        { ...local, courses: Array(10000).fill(course) },
        payload(),
      ),
    ).toThrow("10000");
  });
});
