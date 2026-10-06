// Google 原始事件与课程领域模型分离；重复事件由 API 展开为独立实例。
export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  status?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  location?: string;
  description?: string;
  recurringEventId?: string;
}

export interface CourseEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  location?: string;
  description?: string;
  calendarId: string;
  recurringEventId?: string;
}

export interface CalendarInfo {
  id: string;
  name: string;
  timeZone: string;
}
export interface CalendarSnapshot {
  courses: CourseEvent[];
  calendars: CalendarInfo[];
  selectedCalendarId: string;
  lastSyncTime: string;
  source: "mock" | "google";
}
export type SyncState = "idle" | "syncing" | "error";
