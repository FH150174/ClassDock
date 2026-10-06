import { DateTime } from "luxon";
import type { CalendarSnapshot, GoogleCalendarEvent } from "../types/calendar";
import { parseGoogleEvents } from "../utils/course";

export function mockSnapshot(now = DateTime.local()): CalendarSnapshot {
  const monday = now.startOf("week");
  const events: GoogleCalendarEvent[] = [];
  const plans = [
    {
      title: "数据结构",
      location: "博学楼 · A301",
      hour: 8,
      minute: 30,
      days: [0, 2, 4],
    },
    {
      title: "Java Web 开发",
      location: "厚德楼 · 402",
      hour: 10,
      minute: 20,
      days: [0, 2],
    },
    {
      title: "软件工程",
      location: "教学楼 · 4-302",
      hour: 14,
      minute: 30,
      days: [1, 2, 4],
    },
    {
      title: "数据库原理",
      location: "博学楼 · A205",
      hour: 8,
      minute: 30,
      days: [1, 3],
    },
    {
      title: "计算机网络",
      location: "实验楼 · B203",
      hour: 16,
      minute: 20,
      days: [3],
    },
  ];
  for (let week = -1; week < 5; week++)
    for (const plan of plans)
      for (const day of plan.days) {
        const start = monday
          .plus({ weeks: week, days: day })
          .set({
            hour: plan.hour,
            minute: plan.minute,
            second: 0,
            millisecond: 0,
          });
        events.push({
          id: `${plan.title}-${start.toISODate()}`,
          summary: plan.title,
          start: { dateTime: start.toISO()! },
          end: { dateTime: start.plus({ minutes: 95 }).toISO()! },
          location: plan.location,
          recurringEventId: plan.title,
        });
      }
  const { courses } = parseGoogleEvents(events, "demo-courses", now.zoneName);
  return {
    courses,
    calendars: [
      {
        id: "demo-courses",
        name: "我的课程表（示例）",
        timeZone: now.zoneName,
      },
    ],
    selectedCalendarId: "demo-courses",
    lastSyncTime: now.toISO()!,
    source: "mock",
  };
}
