import { DateTime } from "luxon";
import type { CourseEvent, GoogleCalendarEvent } from "../types/calendar";

export function parseGoogleEvents(
  events: GoogleCalendarEvent[],
  calendarId: string,
  calendarZone: string,
) {
  const courses: CourseEvent[] = [];
  let invalidCount = 0;
  for (const event of events) {
    if (event.status === "cancelled" || event.start?.date || event.end?.date)
      continue;
    const start = DateTime.fromISO(event.start?.dateTime ?? "", {
      zone: event.start?.timeZone ?? calendarZone,
      setZone: true,
    });
    const end = DateTime.fromISO(event.end?.dateTime ?? "", {
      zone: event.end?.timeZone ?? calendarZone,
      setZone: true,
    });
    if (!event.id || !start.isValid || !end.isValid || end <= start) {
      invalidCount++;
      continue;
    }
    courses.push({
      id: event.id,
      title: event.summary?.trim() || "未命名课程",
      startTime: start.toISO()!,
      endTime: end.toISO()!,
      location: event.location,
      description: event.description,
      calendarId,
      recurringEventId: event.recurringEventId,
    });
  }
  return { courses, invalidCount };
}
