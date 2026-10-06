import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { LocalCalendarFile, ManualCourse } from "../types/localCalendar";

const key = "classdock-local-calendar";
let saved: Map<string, string>;
let storage: {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
};
const file = (name = "课程.csv", title = "数学"): LocalCalendarFile => ({
  id: crypto.randomUUID(),
  name,
  format: "csv",
  timeZone: "Asia/Shanghai",
  importedAt: "2026-10-07T00:00:00Z",
  text: `课程名称,开始时间,结束时间\n${title},2026-10-07 08:30,2026-10-07 10:00`,
});
const manual = (): ManualCourse => ({
  id: crypto.randomUUID(),
  title: "手动课程",
  date: "2026-10-07",
  start: "10:30",
  end: "12:00",
  location: "",
  timeZone: "Asia/Shanghai",
});
beforeEach(() => {
  vi.resetModules();
  saved = new Map();
  storage = {
    getItem: vi.fn((key: string) => saved.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => saved.set(key, value)),
  };
  vi.stubGlobal("localStorage", storage);
});
afterEach(() => vi.unstubAllGlobals());
const store = async () =>
  (await import("./localCalendarStore")).useLocalCalendarStore;
describe("本地课表保存", () => {
  it("撤销移除不能覆盖同名的新导入文件", async () => {
    const state = await store();
    const old = file();
    state.getState().importFile(old);
    state.getState().removeFile(old.id);
    state.getState().importFile(file(old.name, "新版课程"));
    expect(() => state.getState().restore(old)).toThrow("不会覆盖");
    expect(state.getState().files[0].text).toContain("新版课程");
  });
  it("同名文件替换，并保留其他文件与手动课程", async () => {
    const state = await store();
    state.getState().importFile(file());
    state.getState().importFile(file("另一个.csv"));
    state.getState().addManual(manual());
    state.getState().importFile(file("课程.csv", "物理"));
    expect(state.getState().files).toHaveLength(2);
    expect(
      state.getState().files.find((f) => f.name === "课程.csv")?.text,
    ).toContain("物理");
    expect(state.getState().manual).toHaveLength(1);
    expect(state.getState().mode).toBe("local");
  });
  it("切换示例模式保留课程，重载后读取已保存数据", async () => {
    const state = await store();
    state.getState().addManual(manual());
    state.getState().setMode("mock");
    vi.resetModules();
    const reloaded = await store();
    expect(reloaded.getState().mode).toBe("mock");
    expect(reloaded.getState().manual).toHaveLength(1);
  });
  it("保存失败时存储和内存都不变", async () => {
    const state = await store();
    state.getState().importFile(file());
    const before = saved.get(key);
    storage.setItem.mockImplementationOnce(() => {
      throw new Error("quota");
    });
    expect(() => state.getState().addManual(manual())).toThrow("保存失败");
    expect(saved.get(key)).toBe(before);
    expect(state.getState().manual).toHaveLength(0);
  });
  it("移除课程后可以恢复", async () => {
    const state = await store();
    const course = manual();
    state.getState().addManual(course);
    state.getState().removeManual(course.id);
    expect(state.getState().manual).toHaveLength(0);
    state.getState().restore(course);
    expect(state.getState().manual[0].id).toBe(course.id);
  });
  it("保存前读取另一个窗口写入的最新数据", async () => {
    const state = await store();
    const other = manual();
    saved.set(
      key,
      JSON.stringify({
        version: 1,
        mode: "local",
        files: [],
        manual: [other],
        updatedAt: "",
      }),
    );
    state.getState().importFile(file());
    expect(state.getState().manual[0].id).toBe(other.id);
  });
  it("损坏的存储不能被新导入静默覆盖", async () => {
    saved.set(key, "broken");
    const state = await store();
    expect(state.getState().readError).toContain("没有被覆盖");
    expect(() => state.getState().importFile(file())).toThrow();
    expect(saved.get(key)).toBe("broken");
  });
  it("无效导入不会覆盖已有课程", async () => {
    const state = await store();
    state.getState().importFile(file());
    const before = saved.get(key);
    expect(() =>
      state.getState().importFile({ ...file(), text: "非法内容" }),
    ).toThrow();
    expect(saved.get(key)).toBe(before);
  });
});
