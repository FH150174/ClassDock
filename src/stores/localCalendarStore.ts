import { create } from "zustand";
import type {
  LocalCalendarData,
  LocalCalendarFile,
  ManualCourse,
} from "../types/localCalendar";
import {
  expandManualCourse,
  localSnapshot,
  parseCalendarFile,
} from "../services/localCalendarService";

export const LOCAL_CALENDAR_KEY = "classdock-local-calendar";
const emptyData = (): LocalCalendarData => ({
  version: 1,
  mode: "mock",
  files: [],
  manual: [],
  updatedAt: "",
});
function readData(): LocalCalendarData {
  const raw = localStorage.getItem(LOCAL_CALENDAR_KEY);
  if (!raw) return emptyData();
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("本地课表格式无效");
  const data = value as LocalCalendarData;
  if (
    data.version !== 1 ||
    !["mock", "local"].includes(data.mode) ||
    !Array.isArray(data.files) ||
    !Array.isArray(data.manual) ||
    typeof data.updatedAt !== "string"
  )
    throw new Error("本地课表格式无效");
  if (
    data.files.some(
      (f) =>
        !f ||
        typeof f.id !== "string" ||
        typeof f.name !== "string" ||
        !["ics", "csv"].includes(f.format) ||
        typeof f.text !== "string" ||
        typeof f.timeZone !== "string" ||
        typeof f.importedAt !== "string",
    ) ||
    data.manual.some(
      (c) =>
        !c ||
        [c.id, c.title, c.date, c.start, c.end, c.location, c.timeZone].some(
          (v) => typeof v !== "string",
        ) ||
        (c.weeklyUntil !== undefined && typeof c.weeklyUntil !== "string"),
    )
  )
    throw new Error("本地课表记录无效");
  return data;
}
interface LocalCalendarState extends LocalCalendarData {
  readError: string | null;
  reload: () => void;
  setMode: (mode: LocalCalendarData["mode"]) => void;
  importFile: (file: LocalCalendarFile) => void;
  addManual: (item: ManualCourse) => void;
  removeFile: (id: string) => void;
  removeManual: (id: string) => void;
  restore: (record: LocalCalendarFile | ManualCourse) => void;
}
function initial() {
  try {
    return { ...readData(), readError: null };
  } catch {
    return {
      ...emptyData(),
      readError: "本地课表读取失败，现有数据没有被覆盖。",
    };
  }
}
export const useLocalCalendarStore = create<LocalCalendarState>((set) => {
  const commit = (
    transform: (current: LocalCalendarData) => LocalCalendarData,
  ) => {
    // 保存成功后才更新内存；从最新存储读取，避免设置窗使用旧快照覆盖其他窗口。
    const next = transform(readData());
    next.updatedAt = new Date().toISOString();
    if (next.files.length > 10 || next.manual.length > 300)
      throw new Error("最多保存 10 个文件和 300 条手动课程");
    localSnapshot(next);
    const encoded = JSON.stringify(next);
    if (new TextEncoder().encode(encoded).byteLength > 3 * 1024 * 1024)
      throw new Error("本地课表已超过 3 MB，请移除部分来源");
    try {
      localStorage.setItem(LOCAL_CALENDAR_KEY, encoded);
    } catch {
      throw new Error("本地课表保存失败，存储空间可能不足。现有课程没有改动。");
    }
    set({ ...next, readError: null });
  };
  return {
    ...initial(),
    reload: () => set(initial()),
    setMode: (mode) => commit((data) => ({ ...data, mode })),
    importFile: (file) => {
      parseCalendarFile(file);
      commit((data) => ({
        ...data,
        mode: "local",
        files: [...data.files.filter((f) => f.name !== file.name), file],
      }));
    },
    addManual: (item) => {
      expandManualCourse(item);
      commit((data) => ({
        ...data,
        mode: "local",
        manual: [...data.manual.filter((c) => c.id !== item.id), item],
      }));
    },
    removeFile: (id) =>
      commit((data) => ({
        ...data,
        files: data.files.filter((f) => f.id !== id),
      })),
    removeManual: (id) =>
      commit((data) => ({
        ...data,
        manual: data.manual.filter((c) => c.id !== id),
      })),
    restore: (record) =>
      commit((data) => {
        if ("format" in record) {
          if (
            data.files.some((f) => f.name === record.name || f.id === record.id)
          )
            throw new Error("已存在同名文件，撤销不会覆盖新导入的课程。");
          return { ...data, files: [...data.files, record] };
        }
        if (data.manual.some((c) => c.id === record.id))
          throw new Error("该课程已经存在，无需重复恢复。");
        return { ...data, manual: [...data.manual, record] };
      }),
  };
});
