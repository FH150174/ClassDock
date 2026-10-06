import type { DateTime } from "luxon";
import type { CourseEvent } from "../types/calendar";
import { weekCourses } from "../services/scheduleService";
import { CourseCard } from "./CourseCard";

export function WeekSchedule({
  courses,
  now,
}: {
  courses: CourseEvent[];
  now: DateTime;
}) {
  const days = weekCourses(courses, now);
  return (
    <section className="schedule week-schedule">
      <div className="section-heading">
        <h2>一周概览</h2>
        <span>
          {days[0].date.toFormat("MM.dd")} – {days[6].date.toFormat("MM.dd")}
        </span>
      </div>
      {days.every((day) => !day.courses.length) && (
        <p className="week-empty">本周暂无课程</p>
      )}
      {days.map((day) => (
        <section
          className={`week-day ${day.date.hasSame(now, "day") ? "is-today" : ""}`}
          key={day.date.toISODate()}
        >
          <div className="day-heading">
            <h3>
              {day.date.setLocale("zh-CN").toFormat("cccc")}{" "}
              <small>{day.date.toFormat("MM.dd")}</small>
            </h3>
            {day.date.hasSame(now, "day") && <span>今天</span>}
          </div>
          {day.courses.length ? (
            day.courses.map((course) => (
              <CourseCard
                compact
                key={`${course.calendarId}:${course.id}`}
                course={course}
                now={now}
              />
            ))
          ) : (
            <p className="free-day">没有课程，留给生活</p>
          )}
        </section>
      ))}
    </section>
  );
}
