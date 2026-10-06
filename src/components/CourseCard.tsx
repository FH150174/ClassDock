import { MapPin, Check, ArrowUpRight } from "lucide-react";
import type { DateTime } from "luxon";
import type { CourseEvent } from "../types/calendar";
import { courseStatus, timeRange } from "../services/scheduleService";

export function CourseCard({
  course,
  now,
  compact = false,
}: {
  course: CourseEvent;
  now: DateTime;
  compact?: boolean;
}) {
  const status = courseStatus(course, now);
  return (
    <article className={`course-card ${status} ${compact ? "compact" : ""}`}>
      <span className="course-dot" />
      <div className="course-content">
        <div className="course-time">
          {timeRange(course)}
          {status === "ongoing" && <span className="live-label">上课中</span>}
        </div>
        <h3>{course.title}</h3>
        {course.location && (
          <p className="location">
            <MapPin size={12} aria-hidden="true" />
            {course.location}
          </p>
        )}
      </div>
      {status === "finished" ? (
        <Check className="course-mark" size={15} aria-label="已结束" />
      ) : (
        <ArrowUpRight className="course-mark" size={15} aria-hidden="true" />
      )}
    </article>
  );
}
