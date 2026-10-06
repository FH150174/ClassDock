import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import type { CourseEvent, GoogleCalendarEvent } from "../types/calendar";
import { nextCourse, todayCourses, weekCourses } from "./scheduleService";
import { parseGoogleEvents } from "../utils/course";

const clock = (iso: string) => DateTime.fromISO(iso, { setZone: true });
const course = (
  id: string,
  startTime: string,
  endTime: string,
): CourseEvent => ({ id, title: id, startTime, endTime, calendarId: "test" });
const morning = course(
  "早课",
  "2026-10-07T08:30:00+08:00",
  "2026-10-07T10:05:00+08:00",
);
const afternoon = course(
  "下午课",
  "2026-10-07T14:30:00+08:00",
  "2026-10-07T16:05:00+08:00",
);
const tomorrow = course(
  "明天课",
  "2026-10-08T08:30:00+08:00",
  "2026-10-08T10:05:00+08:00",
);

describe("日程判断", () => {
  it("今日课程按开始时间排序，不包含明天", () => {
    expect(
      todayCourses(
        [tomorrow, afternoon, morning],
        clock("2026-10-07T12:00:00+08:00"),
        "Asia/Shanghai",
      ).map((c) => c.id),
    ).toEqual(["早课", "下午课"]);
  });
  it("未开始时找到最近的一节课", () => {
    expect(
      nextCourse(
        [tomorrow, afternoon, morning],
        clock("2026-10-07T12:00:00+08:00"),
      ),
    ).toMatchObject({ kind: "upcoming", course: afternoon, minutes: 150 });
  });
  it("正在上课时优先显示当前课程和剩余时间", () => {
    expect(
      nextCourse([afternoon, morning], clock("2026-10-07T09:00:00+08:00")),
    ).toMatchObject({ kind: "ongoing", course: morning, minutes: 65 });
  });
  it("开始时刻算进行中，结束时刻不算", () => {
    expect(nextCourse([morning], clock(morning.startTime)).kind).toBe(
      "ongoing",
    );
    expect(nextCourse([morning], clock(morning.endTime)).kind).toBe("none");
  });
  it("当天已结束，下一节来自明天", () => {
    expect(
      nextCourse(
        [morning, afternoon, tomorrow],
        clock("2026-10-07T19:00:00+08:00"),
      ),
    ).toMatchObject({ kind: "upcoming", course: tomorrow, minutes: 810 });
  });
  it("全部结束或空日历返回无课程", () => {
    expect(nextCourse([morning], clock("2026-10-07T19:00:00+08:00"))).toEqual({
      kind: "none",
    });
    expect(
      todayCourses([], clock("2026-10-07T19:00:00+08:00"), "Asia/Shanghai"),
    ).toEqual([]);
  });
  it("跨天课程在重叠的两天均显示", () => {
    const overnight = course(
      "夜课",
      "2026-10-06T23:30:00+08:00",
      "2026-10-07T01:00:00+08:00",
    );
    for (const date of ["2026-10-06", "2026-10-07"])
      expect(
        todayCourses(
          [overnight],
          clock(`${date}T12:00:00+08:00`),
          "Asia/Shanghai",
        ),
      ).toEqual([overnight]);
    expect(
      nextCourse([overnight], clock("2026-10-07T00:30:00+08:00")),
    ).toMatchObject({ kind: "ongoing", minutes: 30 });
  });
  it("午夜结束的课程不出现在第二天", () => {
    const midnight = course(
      "午夜",
      "2026-10-06T23:00:00+08:00",
      "2026-10-07T00:00:00+08:00",
    );
    expect(
      todayCourses(
        [midnight],
        clock("2026-10-07T12:00:00+08:00"),
        "Asia/Shanghai",
      ),
    ).toEqual([]);
  });
  it("UTC 事件正确落入本地日期", () => {
    const utc = course("UTC", "2026-10-06T23:00:00Z", "2026-10-07T01:00:00Z");
    expect(
      todayCourses([utc], clock("2026-10-07T12:00:00+08:00"), "Asia/Shanghai"),
    ).toEqual([utc]);
    expect(
      todayCourses([utc], clock("2026-10-06T12:00:00+08:00"), "Asia/Shanghai"),
    ).toEqual([]);
  });
  it("DST 切换日使用日历日边界，正确计算实际剩余分钟", () => {
    const dst = course(
      "夏令时",
      "2026-03-08T01:30:00-05:00",
      "2026-03-08T03:30:00-04:00",
    );
    expect(nextCourse([dst], clock("2026-03-08T01:45:00-05:00"))).toMatchObject(
      { kind: "ongoing", minutes: 45 },
    );
    expect(
      todayCourses(
        [dst],
        clock("2026-03-08T12:00:00-04:00"),
        "America/New_York",
      ),
    ).toEqual([dst]);
  });
  it("本周为周一到周日，跨天事件按天分组", () => {
    const days = weekCourses(
      [morning, tomorrow],
      clock("2026-10-07T12:00:00+08:00"),
      "Asia/Shanghai",
    );
    expect(days).toHaveLength(7);
    expect(days[0].date.weekday).toBe(1);
    expect(days[6].date.weekday).toBe(7);
    expect(days[2].courses).toEqual([morning]);
    expect(days[3].courses).toEqual([tomorrow]);
  });
});

describe("Google 原始事件转换", () => {
  const event: GoogleCalendarEvent = {
    id: "instance-1",
    summary: "重复课程",
    recurringEventId: "series-1",
    start: { dateTime: morning.startTime },
    end: { dateTime: morning.endTime },
  };
  it("保留重复事件的每个独立实例", () => {
    const result = parseGoogleEvents(
      [
        event,
        {
          ...event,
          id: "instance-2",
          start: { dateTime: tomorrow.startTime },
          end: { dateTime: tomorrow.endTime },
        },
      ],
      "test",
      "Asia/Shanghai",
    );
    expect(result.courses.map((c) => c.id)).toEqual([
      "instance-1",
      "instance-2",
    ]);
    expect(result.courses[0].recurringEventId).toBe("series-1");
  });
  it("忽略全天事件与已取消事件", () => {
    expect(
      parseGoogleEvents(
        [
          {
            id: "all-day",
            start: { date: "2026-10-07" },
            end: { date: "2026-10-08" },
          },
          { ...event, status: "cancelled" },
        ],
        "test",
        "Asia/Shanghai",
      ).courses,
    ).toEqual([]);
  });
  it("无偏移值时使用日历 IANA 时区", () => {
    const result = parseGoogleEvents(
      [
        {
          ...event,
          start: {
            dateTime: "2026-07-07T09:00:00",
            timeZone: "America/New_York",
          },
          end: {
            dateTime: "2026-07-07T10:00:00",
            timeZone: "America/New_York",
          },
        },
      ],
      "test",
      "Asia/Shanghai",
    );
    expect(Date.parse(result.courses[0].startTime)).toBe(
      Date.parse("2026-07-07T13:00:00Z"),
    );
  });
  it("坏事件单独计数，不影响有效课程", () => {
    const result = parseGoogleEvents(
      [
        { id: "bad" },
        { ...event, end: { dateTime: "2026-10-07T06:00:00+08:00" } },
        event,
      ],
      "test",
      "Asia/Shanghai",
    );
    expect(result.invalidCount).toBe(2);
    expect(result.courses).toHaveLength(1);
  });
});
