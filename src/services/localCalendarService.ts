import ICAL from "ical.js";
import Papa from "papaparse";
import { DateTime } from "luxon";
import type { CourseEvent, CalendarSnapshot } from "../types/calendar";
import type {
  LocalCalendarData,
  LocalCalendarFile,
  ManualCourse,
} from "../types/localCalendar";
import { sortCourses } from "./scheduleService";

type IcalTime = InstanceType<typeof ICAL.Time>;
type IcalComponent = InstanceType<typeof ICAL.Component>;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_COURSES = 5000;
export interface ImportPreview {
  courses: CourseEvent[];
  warnings: string[];
}

function checkedTime(value: string, zone: string) {
  const iso = value.trim().replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso))
    throw new Error("时间需为 YYYY-MM-DD HH:mm 或 ISO 日期时间");
  const date = DateTime.fromISO(iso, { zone, setZone: true });
  if (!date.isValid) throw new Error("日期、时间或时区无效");
  // 夏令时跳跃不能静默把不存在的钟表时间改成另一节课的时间。
  if (
    !/[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) &&
    date.toFormat("yyyy-MM-dd'T'HH:mm") !== iso.slice(0, 16)
  ) {
    throw new Error("当地时区中不存在这个时间");
  }
  return date;
}
function course(
  id: string,
  title: string,
  start: DateTime,
  end: DateTime,
  calendarId: string,
  location = "",
  description = "",
): CourseEvent {
  if (!start.isValid || !end.isValid || end <= start)
    throw new Error("结束时间必须晚于开始时间");
  if (end.diff(start, "days").days > 7)
    throw new Error("单次课程不能超过 7 天");
  return {
    id,
    title: title.trim() || "未命名课程",
    startTime: start.toISO()!,
    endTime: end.toISO()!,
    calendarId,
    location,
    description,
  };
}
function icalDate(
  value: IcalTime,
  component: IcalComponent,
  property: string,
  fallbackZone: string,
  zoneOverride?: string,
): DateTime {
  if (value.year < 1900 || value.year > 2100)
    throw new Error("ICS 课程年份需在 1900–2100 之间");
  if (value.zone.tzid === "UTC" || value.zone.tzid === "Z")
    return DateTime.fromSeconds(value.toUnixTime(), { zone: "utc" });
  const tzid =
    zoneOverride ??
    component.getFirstProperty(property)?.getParameter("tzid") ??
    component.getFirstProperty("dtstart")?.getParameter("tzid");
  if (typeof tzid === "string" && component.getTimeZoneByID(tzid))
    return DateTime.fromSeconds(value.toUnixTime(), { zone: "utc" });
  const zone = typeof tzid === "string" ? tzid : fallbackZone;
  const date = DateTime.fromObject(
    {
      year: value.year,
      month: value.month,
      day: value.day,
      hour: value.hour,
      minute: value.minute,
      second: value.second,
    },
    { zone },
  );
  if (!date.isValid) throw new Error(`无法识别时区或日期：${zone}`);
  return date;
}
function parseIcs(file: LocalCalendarFile, now: DateTime): ImportPreview {
  const root = new ICAL.Component(ICAL.parse(file.text.replace(/^\uFEFF/, "")));
  if (root.name !== "vcalendar") throw new Error("文件必须包含 VCALENDAR 日历");
  const validateDates = (component: IcalComponent) => {
    for (const property of [
      "dtstart",
      "dtend",
      "recurrence-id",
      "exdate",
      "rdate",
    ]) {
      for (const prop of component.getAllProperties(property)) {
        for (const value of prop.getValues()) {
          if (!(value instanceof ICAL.Time))
            throw new Error("暂不支持日期时间段，请导出独立课程");
          if (value.year < 1900 || value.year > 2100)
            throw new Error("ICS 课程与时区年份需在 1900–2100 之间");
        }
      }
    }
    for (const prop of component.getAllProperties("rrule")) {
      const until = (prop.getFirstValue() as InstanceType<typeof ICAL.Recur>)
        .until;
      if (until && (until.year < 1900 || until.year > 2100))
        throw new Error("ICS 重复截止年份需在 1900–2100 之间");
    }
    const duration = component.getFirstPropertyValue("duration");
    if (
      duration instanceof ICAL.Duration &&
      (duration.toSeconds() <= 0 || duration.toSeconds() > 7 * 86400)
    )
      throw new Error("单次课程时长需大于零且不能超过 7 天");
  };
  for (const event of root.getAllSubcomponents("vevent")) validateDates(event);
  for (const zone of root.getAllSubcomponents("vtimezone"))
    for (const observance of zone.getAllSubcomponents())
      validateDates(observance);
  // 时区也有内部重复展开；在任何时间换算前限制规则，避免不可能日期卡住依赖库。
  const zones = root.getAllSubcomponents("vtimezone");
  if (zones.length > 20) throw new Error("内嵌时区过多，请拆分日历");
  for (const zone of zones) {
    const observances = zone.getAllSubcomponents();
    if (observances.length > 80) throw new Error("内嵌时区规则过多");
    for (const observance of observances) {
      const start = observance.getFirstPropertyValue(
        "dtstart",
      ) as IcalTime | null;
      if (!start || start.year < 1900 || start.year > 2100)
        throw new Error("内嵌时区起始年份需在 1900–2100 之间");
      if (observance.getAllProperties("rrule").length > 1)
        throw new Error("不支持多条内嵌时区重复规则");
      for (const prop of observance.getAllProperties("rrule")) {
        const rule = prop.getFirstValue() as InstanceType<typeof ICAL.Recur>;
        const parts = Object.keys(rule.parts);
        const months = rule.parts.BYMONTH;
        const days = rule.parts.BYDAY;
        const monthDays = rule.parts.BYMONTHDAY;
        const simple = parts.length === 0;
        const standard =
          parts.every((p) => ["BYMONTH", "BYDAY", "BYMONTHDAY"].includes(p)) &&
          months?.length === 1 &&
          months.every((m) => Number.isInteger(m) && m >= 1 && m <= 12) &&
          ((days?.length === 1 &&
            !monthDays &&
            days.every((d) => /^[+-]?[1-4](MO|TU|WE|TH|FR|SA|SU)$/.test(d))) ||
            (monthDays?.length === 1 &&
              !days &&
              monthDays.every(
                (d) =>
                  Number.isInteger(d) && Math.abs(d) >= 1 && Math.abs(d) <= 28,
              )));
        if (
          rule.freq !== "YEARLY" ||
          rule.interval !== 1 ||
          (!simple && !standard) ||
          (rule.count !== null &&
            (!Number.isSafeInteger(rule.count) ||
              rule.count < 1 ||
              rule.count > 1000))
        )
          throw new Error(
            "暂不支持复杂的内嵌时区重复规则，请使用 IANA 时区导出",
          );
      }
      if (
        observance.getAllProperties("rdate").flatMap((p) => p.getValues())
          .length > 2000
      )
        throw new Error("内嵌时区日期过多");
    }
  }
  const components = root.getAllSubcomponents("vevent");
  if (components.length > 2000) throw new Error("日历事件过多，请拆分后导入");
  if (
    components.some(
      (c) =>
        c.getFirstProperty("recurrence-id")?.getParameter("range") ===
        "THISANDFUTURE",
    )
  )
    throw new Error(
      "暂不支持从调课日期起修改后续所有实例，请导出拆分后的课程。",
    );
  const result = new Map<string, CourseEvent>();
  const rangeStart = now.startOf("day").minus({ days: 7 });
  const rangeEnd = now.startOf("day").plus({ days: 91 });
  let skipped = 0;
  let steps = 0;
  const cancelled = (comp: IcalComponent) =>
    comp.getFirstPropertyValue("status") === "CANCELLED";
  const add = (
    item: InstanceType<typeof ICAL.Event>,
    start: IcalTime,
    end: IcalTime,
    key: string,
    recurring: boolean,
  ) => {
    if (cancelled(item.component) || start.isDate) {
      skipped++;
      return;
    }
    const startDate = icalDate(start, item.component, "dtstart", file.timeZone);
    const endDate = icalDate(end, item.component, "dtend", file.timeZone);
    const value = course(
      `${file.id}:${key}`,
      item.summary ?? "",
      startDate,
      endDate,
      file.id,
      item.location ?? "",
      item.description ?? "",
    );
    if (recurring && (endDate <= rangeStart || startDate >= rangeEnd)) return;
    if (recurring) value.recurringEventId = `${file.id}:${item.uid}`;
    result.set(value.id, value);
    if (result.size > MAX_COURSES)
      throw new Error("展开后的课程超过 5000 节，请缩小日历范围");
  };
  for (const [index, comp] of components.entries()) {
    const item = new ICAL.Event(comp, {
      exceptions: [],
      strictExceptions: true,
    });
    if (item.isRecurrenceException()) continue;
    if (cancelled(comp) || item.startDate?.isDate) {
      skipped++;
      continue;
    }
    if (
      !comp.hasProperty("dtstart") ||
      (!comp.hasProperty("dtend") && !comp.hasProperty("duration"))
    )
      throw new Error(`事件 ${index + 1} 缺少开始或结束时间`);
    const uid = item.uid || `event-${index}`;
    if (!item.isRecurring()) {
      add(item, item.startDate, item.endDate, uid, false);
      continue;
    }
    const rules = comp.getAllProperties("rrule");
    if (rules.length > 1) throw new Error("一个事件暂只支持一条重复规则");
    let until: DateTime | null = null;
    for (const rule of rules) {
      const value = rule.getFirstValue() as InstanceType<typeof ICAL.Recur>;
      if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(value.freq))
        throw new Error("暂不支持小时、分钟或秒级重复课程");
      const parts = Object.keys(value.parts);
      if (
        parts.some((part) => part !== "BYDAY") ||
        (parts.includes("BYDAY") &&
          (value.freq !== "WEEKLY" ||
            value.parts.BYDAY?.some(
              (day) => !/^(MO|TU|WE|TH|FR|SA|SU)$/.test(day),
            )))
      ) {
        throw new Error(
          "暂不支持复杂的 BY* 重复规则，请改为简单重复或导出独立课程。",
        );
      }
      if (
        !Number.isSafeInteger(value.interval) ||
        value.interval < 1 ||
        value.interval > 1000 ||
        (value.count !== null &&
          (!Number.isSafeInteger(value.count) ||
            value.count < 1 ||
            value.count > 10000))
      )
        throw new Error("重复间隔或次数无效，次数不能超过 10000");
      if (value.until) {
        until = icalDate(value.until, comp, "dtstart", file.timeZone);
        if (value.until.isDate) until = until.endOf("day");
        // 截止点由绝对时间判断，避免未内嵌 VTIMEZONE 的 IANA 时间在库内被当成 floating。
        value.until = null;
      }
    }
    const excluded = new Set(
      comp
        .getAllProperties("exdate")
        .flatMap((prop) =>
          (prop.getValues() as IcalTime[]).map((value) =>
            icalDate(
              value,
              comp,
              "exdate",
              file.timeZone,
              prop.getParameter("tzid") as string | undefined,
            ).toMillis(),
          ),
        ),
    );
    const extraDates = comp.getAllProperties("rdate").flatMap((prop) =>
      prop.getValues().map((value) => {
        if (!(value instanceof ICAL.Time))
          throw new Error("暂不支持 RDATE 时间段，请导出独立课程");
        return icalDate(
          value,
          comp,
          "rdate",
          file.timeZone,
          prop.getParameter("tzid") as string | undefined,
        );
      }),
    );
    // 自行处理附加和排除日期，确保 UTC 与当地时区混用时仍按同一时刻匹配。
    comp.removeAllProperties("exdate");
    comp.removeAllProperties("rdate");
    const exceptions = components.filter(
      (c) =>
        c.getFirstPropertyValue("uid") === item.uid &&
        c.hasProperty("recurrence-id"),
    );

    const exceptionMap = new Map(
      exceptions.map((c) => [
        icalDate(
          new ICAL.Event(c).recurrenceId,
          c,
          "recurrence-id",
          file.timeZone,
        ).toMillis(),
        c,
      ]),
    );
    const iterator = item.iterator();
    let next: IcalTime | null;
    while ((next = iterator.next())) {
      if (++steps > 10000)
        throw new Error("重复规则展开过多，请缩短课程重复范围");
      const original = icalDate(next, comp, "dtstart", file.timeZone);
      if (original >= rangeEnd || (until && original > until)) break;
      if (excluded.has(original.toMillis())) continue;
      const explicit = exceptionMap.get(original.toMillis());
      if (explicit && cancelled(explicit)) {
        skipped++;
        continue;
      }
      const moved = explicit ? new ICAL.Event(explicit) : null;
      const occurrence = moved
        ? { item: moved, startDate: moved.startDate, endDate: moved.endDate }
        : item.getOccurrenceDetails(next);
      add(
        occurrence.item,
        occurrence.startDate,
        occurrence.endDate,
        `${uid}:${original.toMillis()}`,
        true,
      );
    }
    for (const date of extraDates) {
      if (excluded.has(date.toMillis())) continue;
      const exception = exceptionMap.get(date.toMillis());
      if (exception && cancelled(exception)) continue;
      const extra = ICAL.Time.fromJSDate(date.toJSDate(), true);
      const occurrence = item.getOccurrenceDetails(extra);
      add(
        item,
        occurrence.startDate,
        occurrence.endDate,
        `${uid}:${date.toMillis()}`,
        true,
      );
    }
    // 调课可能从展开窗口外移入窗口，单独读取例外，再按原始实例键覆盖。
    for (const exception of exceptions) {
      if (cancelled(exception)) continue;
      const moved = new ICAL.Event(exception);
      add(
        moved,
        moved.startDate,
        moved.endDate,
        `${uid}:${icalDate(moved.recurrenceId, exception, "recurrence-id", file.timeZone).toMillis()}`,
        true,
      );
    }
  }
  // 没有主事件的独立调课实例也应正常显示。
  for (const comp of components.filter((c) => c.hasProperty("recurrence-id"))) {
    if (
      components.some(
        (c) =>
          !c.hasProperty("recurrence-id") &&
          c.getFirstPropertyValue("uid") === comp.getFirstPropertyValue("uid"),
      )
    )
      continue;
    const item = new ICAL.Event(comp, {
      exceptions: [],
      strictExceptions: true,
    });
    if (!cancelled(comp))
      add(
        item,
        item.startDate,
        item.endDate,
        `${item.uid}:${item.recurrenceId.toString()}`,
        true,
      );
  }
  return {
    courses: sortCourses([...result.values()]),
    warnings: skipped ? [`已忽略 ${skipped} 个全天或取消事件 / 实例。`] : [],
  };
}
function parseCsv(file: LocalCalendarFile): ImportPreview {
  const parsed = Papa.parse<Record<string, string>>(
    file.text.replace(/^\uFEFF/, ""),
    {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (h) => h.trim(),
    },
  );
  if (parsed.errors.length)
    throw new Error(`CSV 格式错误：${parsed.errors[0].message}`);
  const headers = parsed.meta.fields ?? [];
  const names = {
    title: ["课程名称", "title"],
    start: ["开始时间", "start"],
    end: ["结束时间", "end"],
    location: ["地点", "location"],
    description: ["备注", "description"],
  };
  const key = (field: keyof typeof names) =>
    names[field].find((n) => headers.includes(n));
  if (!key("title") || !key("start") || !key("end"))
    throw new Error(
      "CSV 表头需包含课程名称、开始时间、结束时间（或 title,start,end）",
    );
  if (parsed.data.length > MAX_COURSES)
    throw new Error("CSV 超过 5000 节课程，请拆分导入");
  const courses = parsed.data.map((row, index) => {
    try {
      const text = (field: keyof typeof names) =>
        row[key(field) ?? ""]?.trim() ?? "";
      if (!text("title")) throw new Error("课程名称不能为空");
      return course(
        `${file.id}:row-${index}`,
        text("title"),
        checkedTime(text("start"), file.timeZone),
        checkedTime(text("end"), file.timeZone),
        file.id,
        text("location"),
        text("description"),
      );
    } catch (error) {
      throw new Error(
        `第 ${index + 2} 行：${error instanceof Error ? error.message : "课程无效"}`,
      );
    }
  });
  return { courses: sortCourses(courses), warnings: [] };
}
export function parseCalendarFile(
  file: LocalCalendarFile,
  now: DateTime = DateTime.local(),
): ImportPreview {
  if (new TextEncoder().encode(file.text).byteLength > MAX_FILE_BYTES)
    throw new Error("文件不能超过 2 MB");
  if (!file.text.trim()) throw new Error("文件为空");
  try {
    return file.format === "ics" ? parseIcs(file, now) : parseCsv(file);
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "日历文件无法解析",
    );
  }
}
export function expandManualCourse(item: ManualCourse): CourseEvent[] {
  if (!item.title.trim()) throw new Error("请输入课程名称");
  const start = checkedTime(`${item.date}T${item.start}`, item.timeZone);
  checkedTime(`${item.date}T${item.end}`, item.timeZone);
  const last = item.weeklyUntil
    ? DateTime.fromISO(item.weeklyUntil, { zone: item.timeZone })
    : start.startOf("day");
  if (!last.isValid || last < start.startOf("day"))
    throw new Error("重复截止日期不能早于起始日期");
  if (last.diff(start.startOf("day"), "days").days > 730)
    throw new Error("每周课程的日期范围不能超过两年");
  const courses: CourseEvent[] = [];
  for (
    let day = start.startOf("day");
    day <= last;
    day = day.plus({ weeks: 1 })
  ) {
    const date = day.toISODate()!;
    courses.push(
      course(
        `manual:${item.id}:${date}`,
        item.title,
        checkedTime(`${date}T${item.start}`, item.timeZone),
        checkedTime(`${date}T${item.end}`, item.timeZone),
        "manual",
        item.location ?? "",
      ),
    );
  }
  return courses;
}
export function localSnapshot(
  data: LocalCalendarData,
  now: DateTime = DateTime.local(),
): CalendarSnapshot {
  const courses = [
    ...data.files.flatMap((f) => parseCalendarFile(f, now).courses),
    ...data.manual.flatMap(expandManualCourse),
  ];
  if (courses.length > MAX_COURSES)
    throw new Error("本地课程合计超过 5000 节，请移除部分来源");
  return {
    courses: sortCourses(courses),
    calendars: [
      { id: "local", name: "自定义课程", timeZone: now.zoneName ?? "UTC" },
    ],
    selectedCalendarId: "local",
    lastSyncTime: data.updatedAt,
    source: "local",
  };
}
