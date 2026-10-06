import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { parseCalendarFile, expandManualCourse } from "./localCalendarService";
import type { LocalCalendarFile, ManualCourse } from "../types/localCalendar";

const now = DateTime.fromISO("2026-10-07T12:00:00+08:00", { setZone: true });
const file = (
  text: string,
  format: "ics" | "csv" = "ics",
): LocalCalendarFile => ({
  id: "fixture",
  name: `课程.${format}`,
  format,
  text,
  timeZone: "Asia/Shanghai",
  importedAt: now.toISO()!,
});
const ics = (...events: string[]) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join("\r\n")}\r\nEND:VCALENDAR`;
const event = (extra = "") =>
  `BEGIN:VEVENT\r\nUID:lesson\r\nDTSTART;TZID=Asia/Shanghai:20261007T083000\r\nDTEND;TZID=Asia/Shanghai:20261007T100500\r\nSUMMARY:数据结构\r\nLOCATION:A301\r\n${extra}\r\nEND:VEVENT`;

describe("本地 ICS 导入", () => {
  it("过大的课程年份在时区扩展之前拒绝", () => {
    expect(() =>
      parseCalendarFile(
        file(ics(event().replaceAll("20261007", "99990101"))),
        now,
      ),
    ).toThrow("年份");
  });
  it("过大的截止年份和持续时间拒绝导入", () => {
    expect(() =>
      parseCalendarFile(
        file(ics(event("RRULE:FREQ=WEEKLY;UNTIL=99990101T000000Z"))),
        now,
      ),
    ).toThrow("年份");
    expect(() =>
      parseCalendarFile(
        file(
          ics(
            event().replace(
              "DTEND;TZID=Asia/Shanghai:20261007T100500",
              "DURATION:P999999D",
            ),
          ),
        ),
        now,
      ),
    ).toThrow("时长");
  });
  it("拒绝会卡住时区内部迭代的规则", () => {
    const zone =
      "BEGIN:VTIMEZONE\r\nTZID:Custom/Zone\r\nBEGIN:STANDARD\r\nDTSTART:20200101T000000\r\nTZOFFSETFROM:+0800\r\nTZOFFSETTO:+0800\r\nRRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30\r\nEND:STANDARD\r\nEND:VTIMEZONE";
    expect(() =>
      parseCalendarFile(
        file(ics(zone, event().replaceAll("Asia/Shanghai", "Custom/Zone"))),
        now,
      ),
    ).toThrow("内嵌时区");
  });
  it("标准年度夏令时时区仍可导入并保持绝对时间", () => {
    const zone =
      "BEGIN:VTIMEZONE\r\nTZID:Custom/Eastern\r\nBEGIN:DAYLIGHT\r\nDTSTART:20200308T020000\r\nTZOFFSETFROM:-0500\r\nTZOFFSETTO:-0400\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU\r\nEND:DAYLIGHT\r\nBEGIN:STANDARD\r\nDTSTART:20201101T020000\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\nRRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU\r\nEND:STANDARD\r\nEND:VTIMEZONE";
    const result = parseCalendarFile(
      file(ics(zone, event().replaceAll("Asia/Shanghai", "Custom/Eastern"))),
      now,
    );
    expect(Date.parse(result.courses[0].startTime)).toBe(
      Date.parse("2026-10-07T12:30:00Z"),
    );
  });
  it("取消的 RDATE 实例不会重新显示", () => {
    const cancelled =
      "BEGIN:VEVENT\r\nUID:lesson\r\nRECURRENCE-ID:20261015T003000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT";
    const result = parseCalendarFile(
      file(
        ics(
          event("RRULE:FREQ=WEEKLY;COUNT=1\r\nRDATE:20261015T003000Z"),
          cancelled,
        ),
      ),
      now,
    );
    expect(result.courses).toHaveLength(1);
  });
  it("拒绝不可能的复杂重复规则，避免解析库无限迭代", () => {
    expect(() =>
      parseCalendarFile(
        file(ics(event("RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30"))),
        now,
      ),
    ).toThrow("复杂");
  });
  it("UTC 截止时间包含处于截止点的当地课程", () => {
    expect(
      parseCalendarFile(
        file(ics(event("RRULE:FREQ=WEEKLY;UNTIL=20261014T003000Z"))),
        now,
      ).courses,
    ).toHaveLength(2);
  });
  it("UTC EXDATE 排除对应的当地课程", () => {
    expect(
      parseCalendarFile(
        file(
          ics(event("RRULE:FREQ=WEEKLY;COUNT=2\r\nEXDATE:20261014T003000Z")),
        ),
        now,
      ).courses,
    ).toHaveLength(1);
  });
  it("UTC RDATE 正确保留绝对时间", () => {
    const result = parseCalendarFile(
      file(ics(event("RDATE:20261014T003000Z"))),
      now,
    );
    expect(result.courses).toHaveLength(2);
    expect(Date.parse(result.courses[1].startTime)).toBe(
      Date.parse("2026-10-14T00:30:00Z"),
    );
  });
  it("每周多星期的常见课程规则仍可导入", () => {
    const result = parseCalendarFile(
      file(ics(event("RRULE:FREQ=WEEKLY;BYDAY=WE,FR;COUNT=4"))),
      now,
    );
    expect(result.courses).toHaveLength(4);
  });
  it("UTC 调课标识替代 IANA 时区主事件且不重复", () => {
    const moved = event()
      .replace(
        "DTSTART;TZID=Asia/Shanghai:20261007T083000",
        "DTSTART;TZID=Asia/Shanghai:20261015T140000",
      )
      .replace(
        "DTEND;TZID=Asia/Shanghai:20261007T100500",
        "DTEND;TZID=Asia/Shanghai:20261015T153500",
      )
      .replace(
        "SUMMARY:数据结构",
        "RECURRENCE-ID:20261014T003000Z\r\nSUMMARY:UTC调课",
      );
    const result = parseCalendarFile(
      file(ics(event("RRULE:FREQ=WEEKLY;COUNT=2"), moved)),
      now,
    );
    expect(result.courses).toHaveLength(2);
    expect(result.courses[1].title).toBe("UTC调课");
    expect(result.courses[1].startTime).toContain("2026-10-15");
  });
  it("UTC 标识的取消实例被正确排除", () => {
    const cancelled =
      "BEGIN:VEVENT\r\nUID:lesson\r\nRECURRENCE-ID:20261014T003000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT";
    const result = parseCalendarFile(
      file(ics(event("RRULE:FREQ=WEEKLY;COUNT=2"), cancelled)),
      now,
    );
    expect(result.courses).toHaveLength(1);
  });
  it("缺少可选标题的合法事件使用默认名称", () => {
    const text = event().replace("SUMMARY:数据结构\r\n", "");
    expect(parseCalendarFile(file(ics(text)), now).courses[0].title).toBe(
      "未命名课程",
    );
  });
  it("不支持的范围调课明确拒绝导入", () => {
    const cancelled =
      "BEGIN:VEVENT\r\nUID:lesson\r\nRECURRENCE-ID;RANGE=THISANDFUTURE:20261014T003000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT";
    expect(() =>
      parseCalendarFile(
        file(ics(event("RRULE:FREQ=WEEKLY;COUNT=2"), cancelled)),
        now,
      ),
    ).toThrow("暂不支持");
  });
  it("调课只影响同 UID 的重复课程", () => {
    const other = event("RRULE:FREQ=WEEKLY;COUNT=2")
      .replace("UID:lesson", "UID:other")
      .replace("SUMMARY:数据结构", "SUMMARY:英语");
    const moved = event()
      .replace(
        "DTSTART;TZID=Asia/Shanghai:20261007T083000",
        "DTSTART;TZID=Asia/Shanghai:20261015T140000",
      )
      .replace(
        "DTEND;TZID=Asia/Shanghai:20261007T100500",
        "DTEND;TZID=Asia/Shanghai:20261015T153500",
      )
      .replace(
        "SUMMARY:数据结构",
        "RECURRENCE-ID;TZID=Asia/Shanghai:20261014T083000\r\nSUMMARY:调课",
      );
    const result = parseCalendarFile(
      file(ics(event("RRULE:FREQ=WEEKLY;COUNT=2"), other, moved)),
      now,
    );
    expect(result.courses.filter((c) => c.title === "英语")).toHaveLength(2);
    expect(result.courses.filter((c) => c.title === "调课")).toHaveLength(1);
    expect(result.courses).toHaveLength(4);
  });
  it("保留无 VTIMEZONE 的 IANA 时区和地点", () => {
    const result = parseCalendarFile(file(ics(event())), now);
    expect(result.courses).toHaveLength(1);
    expect(Date.parse(result.courses[0].startTime)).toBe(
      Date.parse("2026-10-07T00:30:00Z"),
    );
    expect(result.courses[0].location).toBe("A301");
  });
  it("UTC 时间保持绝对时刻", () => {
    const text = event().replace(
      "DTSTART;TZID=Asia/Shanghai:20261007T083000",
      "DTSTART:20261007T003000Z",
    );
    expect(
      Date.parse(parseCalendarFile(file(ics(text)), now).courses[0].startTime),
    ).toBe(Date.parse("2026-10-07T00:30:00Z"));
  });
  it("处理折行、转义逗号与说明", () => {
    const text = event().replace(
      "SUMMARY:数据结构",
      "SUMMARY:数据结构\\,\r\n 实验",
    );
    expect(parseCalendarFile(file(ics(text)), now).courses[0].title).toBe(
      "数据结构,实验",
    );
  });
  it("展开每周重复并排除 EXDATE", () => {
    const result = parseCalendarFile(
      file(
        ics(
          event(
            "RRULE:FREQ=WEEKLY;COUNT=4\r\nEXDATE;TZID=Asia/Shanghai:20261014T083000",
          ),
        ),
      ),
      now,
    );
    expect(result.courses).toHaveLength(3);
    expect(result.courses.map((c) => c.startTime.slice(0, 10))).toEqual([
      "2026-10-07",
      "2026-10-21",
      "2026-10-28",
    ]);
  });
  it("取消的重复实例不会显示", () => {
    const cancelled = `BEGIN:VEVENT\r\nUID:lesson\r\nRECURRENCE-ID;TZID=Asia/Shanghai:20261014T083000\r\nSTATUS:CANCELLED\r\nEND:VEVENT`;
    expect(
      parseCalendarFile(
        file(ics(event("RRULE:FREQ=WEEKLY;COUNT=3"), cancelled)),
        now,
      ).courses,
    ).toHaveLength(2);
  });
  it("调课实例替代原始时间", () => {
    const moved = event()
      .replace(
        "DTSTART;TZID=Asia/Shanghai:20261007T083000",
        "DTSTART;TZID=Asia/Shanghai:20261015T140000",
      )
      .replace(
        "DTEND;TZID=Asia/Shanghai:20261007T100500",
        "DTEND;TZID=Asia/Shanghai:20261015T153500",
      )
      .replace(
        "SUMMARY:数据结构",
        "RECURRENCE-ID;TZID=Asia/Shanghai:20261014T083000\r\nSUMMARY:调课",
      );
    const result = parseCalendarFile(
      file(ics(event("RRULE:FREQ=WEEKLY;COUNT=2"), moved)),
      now,
    );
    expect(result.courses.map((c) => c.title)).toEqual(["数据结构", "调课"]);
    expect(result.courses[1].startTime.slice(0, 10)).toBe("2026-10-15");
  });
  it("过滤全天和取消课程，并说明原因", () => {
    const allDay =
      "BEGIN:VEVENT\r\nUID:holiday\r\nDTSTART;VALUE=DATE:20261007\r\nDTEND;VALUE=DATE:20261008\r\nSUMMARY:假期\r\nEND:VEVENT";
    const result = parseCalendarFile(
      file(ics(event(), allDay, event("STATUS:CANCELLED"))),
      now,
    );
    expect(result.courses).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it("拒绝未知时区和无效日历", () => {
    expect(() =>
      parseCalendarFile(
        file(ics(event().replaceAll("Asia/Shanghai", "Unknown/Zone"))),
        now,
      ),
    ).toThrow(/时区/);
    expect(() => parseCalendarFile(file("这不是日历"), now)).toThrow();
  });
  it("重复规则按滚动日期重新展开", () => {
    const imported = file(ics(event("RRULE:FREQ=WEEKLY")));
    const future = DateTime.fromISO("2027-04-07T12:00:00+08:00", {
      setZone: true,
    });
    const result = parseCalendarFile(imported, future);
    expect(
      result.courses.some((c) => c.startTime.startsWith("2027-04-07")),
    ).toBe(true);
    expect(
      result.courses.every(
        (c) => Date.parse(c.startTime) < future.plus({ days: 91 }).toMillis(),
      ),
    ).toBe(true);
  });
  it("拒绝高频重复，避免导入时阻塞界面", () => {
    expect(() =>
      parseCalendarFile(file(ics(event("RRULE:FREQ=SECONDLY"))), now),
    ).toThrow(/重复/);
  });
});

describe("CSV 与手动课程", () => {
  it("识别中文表头、BOM、带引号的逗号与换行", () => {
    const csv =
      '\uFEFF课程名称,开始时间,结束时间,地点,备注\r\n"程序设计,实验",2026-10-07 08:30,2026-10-07 10:05,A301,"第一行\n第二行"';
    const result = parseCalendarFile(file(csv, "csv"), now);
    expect(result.courses[0].title).toBe("程序设计,实验");
    expect(result.courses[0].description).toBe("第一行\n第二行");
  });
  it("英文表头可使用带偏移 ISO 时间", () => {
    const csv =
      "title,start,end\n课,2026-10-07T08:30:00+08:00,2026-10-07T10:05:00+08:00";
    expect(parseCalendarFile(file(csv, "csv"), now).courses).toHaveLength(1);
  });
  it("坏行拒绝整个导入，保留现有数据", () => {
    expect(() =>
      parseCalendarFile(
        file(
          "课程名称,开始时间,结束时间\n课,2026-10-07 10:00,2026-10-07 09:00",
          "csv",
        ),
        now,
      ),
    ).toThrow(/第 2 行/);
    expect(() =>
      parseCalendarFile(file("名称,日期\n课,今天", "csv"), now),
    ).toThrow(/表头/);
  });
  const manual: ManualCourse = {
    id: "manual",
    title: "手动课",
    date: "2026-10-07",
    start: "08:30",
    end: "10:05",
    location: "A301",
    weeklyUntil: "2026-10-21",
    timeZone: "Asia/Shanghai",
  };
  it("每周重复按截止日期展开", () => {
    expect(
      expandManualCourse(manual).map((c) => c.startTime.slice(0, 10)),
    ).toEqual(["2026-10-07", "2026-10-14", "2026-10-21"]);
  });
  it("单次课程与非法输入", () => {
    expect(
      expandManualCourse({ ...manual, weeklyUntil: undefined }),
    ).toHaveLength(1);
    expect(() => expandManualCourse({ ...manual, title: " " })).toThrow();
    expect(() => expandManualCourse({ ...manual, end: "07:00" })).toThrow();
    expect(() =>
      expandManualCourse({ ...manual, date: "2026-02-30" }),
    ).toThrow();
    expect(() =>
      expandManualCourse({ ...manual, weeklyUntil: "2026-09-01" }),
    ).toThrow();
  });
  it("每周课程跨夏令时时保持当地钟表时间", () => {
    const result = expandManualCourse({
      ...manual,
      timeZone: "America/New_York",
      date: "2026-03-01",
      weeklyUntil: "2026-03-15",
    });
    expect(result.map((c) => c.startTime.slice(11, 16))).toEqual([
      "08:30",
      "08:30",
      "08:30",
    ]);
    expect(result[0].startTime.endsWith("-05:00")).toBe(true);
    expect(result[1].startTime.endsWith("-04:00")).toBe(true);
  });
  it("超过大小限制的文件被拒绝", () => {
    expect(() =>
      parseCalendarFile(file("x".repeat(2 * 1024 * 1024 + 1), "csv"), now),
    ).toThrow(/2 MB/);
  });
});
