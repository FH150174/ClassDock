import { isTauri, invoke } from "@tauri-apps/api/core";
import { DateTime } from "luxon";
import { parseGoogleEvents } from "../utils/course";
import { sortCourses } from "./scheduleService";
import type {
  CalendarInfo,
  CalendarSnapshot,
  GoogleCalendarEvent,
} from "../types/calendar";

export interface GoogleError {
  code: string;
  message: string;
}
export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  authorizing: boolean;
  selectedCalendarId: string | null;
  lastSyncTime: string | null;
  error: GoogleError | null;
}
export interface GoogleCalendar extends CalendarInfo {
  primary: boolean;
}
export interface GooglePayload {
  calendar: GoogleCalendar;
  events: GoogleCalendarEvent[];
  lastSyncTime: string;
  warning: GoogleError | null;
}
export const GOOGLE_EVENT = "google-calendar-changed";
export function googleMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return error instanceof Error
    ? error.message
    : "Google 操作未完成，请稍后重试。";
}
async function command<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri()) throw new Error("Google 登录需要使用 Windows 桌面应用。");
  try {
    return await invoke<T>(name, args);
  } catch (error) {
    throw new Error(googleMessage(error));
  }
}
export const googleService = {
  status: () => command<GoogleStatus>("google_status"),
  configure: (clientId: string, clientSecret: string) =>
    command<GoogleStatus>("google_configure", {
      client: { clientId, clientSecret },
    }),
  connect: () => command<GoogleStatus>("google_connect"),
  cancel: () => command<void>("google_cancel"),
  calendars: () => command<GoogleCalendar[]>("google_calendars"),
  select: (calendarId: string) =>
    command<GooglePayload>("google_select", { calendarId }),
  load: (force = false) =>
    isTauri()
      ? command<GooglePayload | null>("google_load", { force })
      : Promise.resolve(null),
  disconnect: () => command<GoogleStatus>("google_disconnect"),
};
export function desktopClientJson(text: string) {
  if (new TextEncoder().encode(text).byteLength > 32 * 1024)
    throw new Error("OAuth 配置文件不能超过 32 KB");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("OAuth JSON 文件格式无效");
  }
  if (
    !data ||
    typeof data !== "object" ||
    !("installed" in data) ||
    !data.installed ||
    typeof data.installed !== "object"
  )
    throw new Error("请下载桌面应用类型的 OAuth JSON，不能使用 Web 应用配置。");
  const installed = data.installed;
  if (
    !("client_id" in installed) ||
    typeof installed.client_id !== "string" ||
    !installed.client_id.endsWith(".apps.googleusercontent.com")
  )
    throw new Error("OAuth 文件缺少有效的 Client ID");
  const secret = "client_secret" in installed ? installed.client_secret : "";
  if (typeof secret !== "string") throw new Error("OAuth 客户端密钥格式无效");
  // 不读取文件中自定义的授权或令牌地址，后端始终连接固定的 Google 端点。
  return { clientId: installed.client_id, clientSecret: secret };
}
export function mergeGoogleCourses(
  local: CalendarSnapshot,
  payload: GooglePayload | null,
): CalendarSnapshot {
  if (!payload) return local;
  if (
    !payload.calendar ||
    typeof payload.calendar.id !== "string" ||
    typeof payload.calendar.name !== "string" ||
    typeof payload.calendar.timeZone !== "string" ||
    !Array.isArray(payload.events) ||
    !DateTime.fromISO(payload.lastSyncTime, { setZone: true }).isValid
  )
    throw new Error("Google 课程缓存格式无效，请重新同步或选择日历。");
  let malformed = 0;
  const events = payload.events.filter((event) => {
    const valid =
      !!event &&
      typeof event === "object" &&
      typeof event.id === "string" &&
      [
        "summary",
        "status",
        "location",
        "description",
        "recurringEventId",
      ].every((key) => {
        const value = event[key as keyof GoogleCalendarEvent];
        return value === undefined || typeof value === "string";
      }) &&
      ["start", "end"].every((key) => {
        const value = event[key as "start" | "end"];
        return (
          value === undefined ||
          (value !== null &&
            typeof value === "object" &&
            [value.date, value.dateTime, value.timeZone].every(
              (v) => v === undefined || typeof v === "string",
            ))
        );
      });
    if (!valid) malformed++;
    return valid;
  });
  const parsed = parseGoogleEvents(
    events,
    payload.calendar.id,
    payload.calendar.timeZone,
  );
  const googleCourses = parsed.courses.map((course) => ({
    ...course,
    id: `google:${payload.calendar.id}:${course.id}`,
  }));
  const courses = sortCourses([...local.courses, ...googleCourses]);
  if (courses.length > 10000)
    throw new Error("Google 与本地课程合计超过 10000 节，请减少课程来源。");
  const notes = [
    payload.warning?.message,
    malformed + parsed.invalidCount > 0
      ? `已忽略 ${malformed + parsed.invalidCount} 条无效 Google 课程。`
      : null,
  ].filter(Boolean);
  return {
    ...local,
    courses,
    calendars: [...local.calendars, payload.calendar],
    selectedCalendarId: payload.calendar.id,
    lastSyncTime: payload.lastSyncTime,
    source: local.courses.length > 0 ? "mixed" : "google",
    warning: notes.length ? notes.join(" ") : undefined,
  };
}
