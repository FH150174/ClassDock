import { Coffee } from "lucide-react";
import type { DateTime } from "luxon";
import type { CourseEvent } from "../types/calendar";
import { todayCourses } from "../services/scheduleService";
import { CourseCard } from "./CourseCard";

export function TodaySchedule({
  courses,
  now,
}: {
  courses: CourseEvent[];
  now: DateTime;
}) {
  const today = todayCourses(courses, now);
  return (
    <section className="schedule">
      <div className="section-heading">
        <h2>今日安排</h2>
        <span>{today.length} 节课程</span>
      </div>
      {today.length ? (
        <div className="course-list">
          {today.map((course) => (
            <CourseCard
              key={`${course.calendarId}:${course.id}`}
              course={course}
              now={now}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Coffee size={23} />
          <h3>今天没有课程</h3>
          <p>放慢一点，做些喜欢的事。</p>
        </div>
      )}
    </section>
  );
}
