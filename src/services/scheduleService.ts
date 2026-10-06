import { DateTime } from "luxon";
import type { CourseEvent } from "../types/calendar";

export const localZone = () => DateTime.local().zoneName;
export const startOf = (course: CourseEvent) =>
  DateTime.fromISO(course.startTime, { setZone: true });
export const endOf = (course: CourseEvent) =>
  DateTime.fromISO(course.endTime, { setZone: true });
export const sortCourses = (courses: CourseEvent[]) =>
  [...courses].sort((a, b) => startOf(a).toMillis() - startOf(b).toMillis());

export function todayCourses(
  courses: CourseEvent[],
  now: DateTime,
  zone = localZone(),
): CourseEvent[] {
  const start = now.setZone(zone).startOf("day");
  const end = start.plus({ days: 1 });
  // 采用半开区间，午夜结束的课程不计入第二天。
  return sortCourses(
    courses.filter((course) => startOf(course) < end && endOf(course) > start),
  );
}

export type NextCourse =
  | { kind: "ongoing" | "upcoming"; course: CourseEvent; minutes: number }
  | { kind: "none" };
export function nextCourse(courses: CourseEvent[], now: DateTime): NextCourse {
  const active = sortCourses(courses).find(
    (course) => startOf(course) <= now && endOf(course) > now,
  );
  if (active)
    return {
      kind: "ongoing",
      course: active,
      minutes: Math.ceil(endOf(active).diff(now, "minutes").minutes),
    };
  const next = sortCourses(courses).find((course) => startOf(course) > now);
  return next
    ? {
        kind: "upcoming",
        course: next,
        minutes: Math.ceil(startOf(next).diff(now, "minutes").minutes),
      }
    : { kind: "none" };
}

export function weekCourses(
  courses: CourseEvent[],
  now: DateTime,
  zone = localZone(),
) {
  const monday = now.setZone(zone).startOf("week");
  return Array.from({ length: 7 }, (_, i) => {
    const date = monday.plus({ days: i });
    return { date, courses: todayCourses(courses, date, zone) };
  });
}

export function courseStatus(course: CourseEvent, now: DateTime) {
  if (endOf(course) <= now) return "finished";
  return startOf(course) <= now ? "ongoing" : "upcoming";
}

export function timeRange(course: CourseEvent, zone = localZone()) {
  const start = startOf(course).setZone(zone);
  const end = endOf(course).setZone(zone);
  return `${start.toFormat("HH:mm")} – ${end.toFormat(start.hasSame(end, "day") ? "HH:mm" : "MM/dd HH:mm")}`;
}

export function relativeDay(iso: string, now: DateTime, zone = localZone()) {
  const date = DateTime.fromISO(iso, { setZone: true }).setZone(zone);
  const today = now.setZone(zone).startOf("day");
  const prefix = date.hasSame(today, "day")
    ? "今天"
    : date.hasSame(today.plus({ days: 1 }), "day")
      ? "明天"
      : date.toFormat("M月d日");
  return `${prefix} ${date.toFormat("HH:mm")}`;
}

export function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours
    ? `${hours} 小时${rest ? ` ${rest} 分钟` : ""}`
    : `${minutes} 分钟`;
}
