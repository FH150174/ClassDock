import { ArrowUpRight, Clock3, MapPin, Coffee } from "lucide-react";
import type { DateTime } from "luxon";
import type { CourseEvent } from "../types/calendar";
import {
  durationLabel,
  endOf,
  localZone,
  nextCourse,
  relativeDay,
  startOf,
  todayCourses,
} from "../services/scheduleService";

export function NextClass({
  courses,
  now,
}: {
  courses: CourseEvent[];
  now: DateTime;
}) {
  const next = nextCourse(courses, now);
  if (next.kind === "none")
    return (
      <section className="next-card empty-next">
        <Coffee size={25} />
        <h2>给自己一点留白</h2>
        <p>暂无后续课程，享受自由时间。</p>
      </section>
    );
  const ended = todayCourses(courses, now).every(
    (course) => Date.parse(course.endTime) <= now.toMillis(),
  );
  const start = startOf(next.course).setZone(localZone());
  const end = endOf(next.course).setZone(localZone());
  return (
    <section
      className={`next-card ${next.kind}`}
      aria-label={next.kind === "ongoing" ? "正在上课" : "下一节课"}
    >
      <div className="next-eyebrow">
        <span>
          <span className="status-dot" />
          {next.kind === "ongoing" ? "正在上课" : "下一节课"}
        </span>
        <ArrowUpRight size={17} />
      </div>
      <h2>{next.course.title}</h2>
      <p className="next-time">
        {relativeDay(next.course.startTime, now)}
        <span> / </span>
        {end.toFormat(start.hasSame(end, "day") ? "HH:mm" : "MM/dd HH:mm")}
      </p>
      {next.course.location && (
        <p className="location">
          <MapPin size={13} aria-hidden="true" />
          {next.course.location}
        </p>
      )}
      <div className="countdown">
        <Clock3 size={14} aria-hidden="true" />
        <span>
          {next.kind === "ongoing" ? "剩余 " : "还有 "}
          {durationLabel(next.minutes)}
        </span>
      </div>
      {ended &&
        !startOf(next.course).setZone(localZone()).hasSame(now, "day") && (
          <p className="day-ended">今日课程已结束 · 下一次出发见</p>
        )}
    </section>
  );
}
