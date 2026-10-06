import { useState, type ChangeEvent, type FormEvent } from "react";
import { DateTime } from "luxon";
import { Upload, Plus, Trash2, Undo2 } from "lucide-react";
import { useLocalCalendarStore } from "../stores/localCalendarStore";
import { useCalendarStore } from "../stores/calendarStore";
import {
  MAX_FILE_BYTES,
  parseCalendarFile,
  type ImportPreview,
} from "../services/localCalendarService";
import type { LocalCalendarFile, ManualCourse } from "../types/localCalendar";

export function CourseSources() {
  const data = useLocalCalendarStore();
  const refresh = useCalendarStore((state) => state.refresh);
  const [pending, setPending] = useState<{
    file: LocalCalendarFile;
    preview: ImportPreview;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removed, setRemoved] = useState<
    LocalCalendarFile | ManualCourse | null
  >(null);
  const [pasted, setPasted] = useState("");
  const [pasteFormat, setPasteFormat] = useState<"ics" | "csv">("ics");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(DateTime.local().toISODate()!);
  const [start, setStart] = useState("08:30");
  const [end, setEnd] = useState("10:05");
  const [location, setLocation] = useState("");
  const [weekly, setWeekly] = useState(false);
  const [until, setUntil] = useState(
    DateTime.local().plus({ weeks: 16 }).toISODate()!,
  );
  const act = (action: () => void, message: string) => {
    try {
      action();
      setError("");
      setNotice(message);
      void refresh();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请重试。");
      setNotice("");
      return false;
    }
  };
  const preview = (text: string, name: string, format: "ics" | "csv") => {
    setPending(null);
    setError("");
    setNotice("");
    try {
      const file: LocalCalendarFile = {
        id: `file-${crypto.randomUUID()}`,
        name,
        format,
        text,
        timeZone: DateTime.local().zoneName,
        importedAt: new Date().toISOString(),
      };
      setPending({ file, preview: parseCalendarFile(file) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "文件无法解析");
    }
  };
  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setPending(null);
    setError("");
    setNotice("");
    if (file.size > MAX_FILE_BYTES) {
      setError("文件不能超过 2 MB");
      return;
    }
    const format = file.name.toLowerCase().endsWith(".ics")
      ? "ics"
      : file.name.toLowerCase().endsWith(".csv")
        ? "csv"
        : null;
    if (!format) {
      setError("请选择 .ics 或 UTF-8 .csv 文件");
      return;
    }
    setBusy(true);
    try {
      preview(await file.text(), file.name, format);
    } catch {
      setError("文件读取失败，请重新选择。");
    } finally {
      setBusy(false);
    }
  };
  const addManual = (event: FormEvent) => {
    event.preventDefault();
    const item: ManualCourse = {
      id: crypto.randomUUID(),
      title: title.trim(),
      date,
      start,
      end,
      location: location.trim(),
      timeZone: DateTime.local().zoneName,
      weeklyUntil: weekly ? until : undefined,
    };
    if (
      act(() => data.addManual(item), "课程已保存，课程表已切换到自定义来源。")
    ) {
      setTitle("");
      setLocation("");
    }
  };
  const downloadTemplate = () => {
    const today = DateTime.local().toISODate();
    const blob = new Blob(
      [
        `\uFEFF课程名称,开始时间,结束时间,地点,备注\r\n示例课程,${today} 08:30,${today} 10:05,A301,可用 Excel 编辑并保存为 CSV UTF-8\r\n`,
      ],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "ClassDock-课程模板.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="settings-section course-sources">
      <h2>课程来源</h2>
      <div className="source-options" role="group" aria-label="课程数据来源">
        <button
          type="button"
          aria-pressed={data.mode === "local"}
          className={data.mode === "local" ? "selected" : ""}
          onClick={() => act(() => data.setMode("local"), "已显示自定义课程。")}
        >
          自定义课程
        </button>
        <button
          type="button"
          aria-pressed={data.mode === "mock"}
          className={data.mode === "mock" ? "selected" : ""}
          onClick={() =>
            act(() => data.setMode("mock"), "已显示示例课程，本地课程仍保留。")
          }
        >
          示例课程
        </button>
      </div>
      <p className="setting-help">
        本地文件与手动课程一起显示，保存在这台电脑。也可在下方连接 Google 日历，与本地课程一起显示。
      </p>
      <label className="setting-label" htmlFor="calendar-file">
        选择课程文件（ICS / CSV）
      </label>
      <input
        id="calendar-file"
        type="file"
        accept=".ics,.csv,text/calendar,text/csv"
        onChange={(event) => void chooseFile(event)}
        disabled={busy}
      />
      <div className="import-actions">
        <button
          type="button"
          className="text-action"
          onClick={downloadTemplate}
        >
          下载 CSV 模板
        </button>
        <span>UTF-8 · 每个文件不超过 2 MB</span>
      </div>
      <details className="source-details">
        <summary>粘贴日历内容</summary>
        <label className="setting-label" htmlFor="paste-format">
          内容格式
        </label>
        <select
          id="paste-format"
          disabled={busy}
          value={pasteFormat}
          onChange={(event) => {
            setPasteFormat(event.target.value as "ics" | "csv");
            setPending(null);
          }}
        >
          <option value="ics">ICS 日历</option>
          <option value="csv">CSV 课程表</option>
        </select>
        <label className="setting-label" htmlFor="calendar-paste">
          日历文本
        </label>
        <textarea
          id="calendar-paste"
          disabled={busy}
          rows={4}
          value={pasted}
          onChange={(event) => {
            setPasted(event.target.value);
            setPending(null);
          }}
          placeholder={
            pasteFormat === "ics"
              ? "BEGIN:VCALENDAR…"
              : "课程名称,开始时间,结束时间,地点,备注"
          }
        />
        <button
          type="button"
          className="primary-action"
          disabled={busy || !pasted.trim()}
          onClick={() =>
            preview(pasted, `粘贴课表.${pasteFormat}`, pasteFormat)
          }
        >
          解析并预览
        </button>
      </details>
      {busy && (
        <p className="setting-help" role="status">
          正在读取文件…
        </p>
      )}
      {pending && (
        <div className="import-preview" aria-label="导入预览">
          <strong>{pending.file.name}</strong>
          <p>
            可显示 {pending.preview.courses.length}{" "}
            节课程。同名文件会被替换，其他来源保留。
          </p>
          {pending.file.format === "ics" && (
            <p>
              重复课程按当前日期展开过去 7 天与未来 90
              天，之后每天自动更新范围。
            </p>
          )}
          <ul>
            {pending.preview.courses.slice(0, 3).map((c) => (
              <li key={c.id}>
                {c.title} ·{" "}
                {DateTime.fromISO(c.startTime)
                  .toLocal()
                  .toFormat("MM/dd HH:mm")}
              </li>
            ))}
          </ul>
          {pending.preview.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          <div className="import-actions">
            <button
              type="button"
              className="primary-action"
              onClick={() => {
                if (
                  act(
                    () => data.importFile(pending.file),
                    "导入成功，课程表已切换到自定义来源。",
                  )
                ) {
                  setPending(null);
                  setPasted("");
                }
              }}
            >
              <Upload size={13} />
              导入并显示
            </button>
            <button
              type="button"
              className="text-action"
              onClick={() => setPending(null)}
            >
              取消
            </button>
          </div>
        </div>
      )}
      <details className="source-details">
        <summary>手动添加课程</summary>
        <form onSubmit={addManual} className="manual-form">
          <label>
            课程名称
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
            />
          </label>
          <label>
            起始日期
            <input
              type="date"
              value={date}
              onInput={(e) => setDate(e.currentTarget.value)}
              required
            />
          </label>
          <div className="form-columns">
            <label>
              开始时间
              <input
                type="time"
                value={start}
                onInput={(e) => setStart(e.currentTarget.value)}
                required
              />
            </label>
            <label>
              结束时间
              <input
                type="time"
                value={end}
                onInput={(e) => setEnd(e.currentTarget.value)}
                required
              />
            </label>
          </div>
          <label>
            地点
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              maxLength={200}
            />
          </label>
          <label className="weekly-toggle">
            <input
              type="checkbox"
              checked={weekly}
              onChange={(e) => setWeekly(e.target.checked)}
            />
            每周在同一星期重复
          </label>
          {weekly && (
            <label>
              重复截止日期
              <input
                type="date"
                value={until}
                min={date}
                onInput={(e) => setUntil(e.currentTarget.value)}
                required
              />
            </label>
          )}
          <p className="setting-help">
            使用系统当地时区；手动课程的开始和结束在同一天。
          </p>
          <button className="primary-action" type="submit">
            <Plus size={13} />
            保存课程
          </button>
        </form>
      </details>
      {(data.files.length > 0 || data.manual.length > 0) && (
        <div className="saved-sources" aria-label="已保存的课程来源">
          <h3>
            已保存 · {data.files.length} 个文件 / {data.manual.length}{" "}
            条手动课程
          </h3>
          {data.files.map((f) => (
            <div className="saved-source" key={f.id}>
              <span>
                <strong>{f.name}</strong>
                <small>{f.format.toUpperCase()} · 本地文件</small>
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={`移除文件 ${f.name}`}
                onClick={() => {
                  if (
                    act(() => data.removeFile(f.id), "文件课程已移除，可撤销。")
                  )
                    setRemoved(f);
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {data.manual.map((c) => (
            <div className="saved-source" key={c.id}>
              <span>
                <strong>{c.title}</strong>
                <small>
                  {c.date} · {c.start}–{c.end}
                  {c.weeklyUntil ? ` · 每周至 ${c.weeklyUntil}` : ""}
                </small>
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={`移除手动课程 ${c.title}`}
                onClick={() => {
                  if (
                    act(
                      () => data.removeManual(c.id),
                      "手动课程已移除，可撤销。",
                    )
                  )
                    setRemoved(c);
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {removed && (
        <button
          type="button"
          className="text-action undo-action"
          onClick={() => {
            if (act(() => data.restore(removed), "课程已恢复。"))
              setRemoved(null);
          }}
        >
          <Undo2 size={13} />
          撤销移除
        </button>
      )}
      {(error || data.readError) && (
        <p className="error-note" role="alert">
          {error || data.readError}
        </p>
      )}
      {notice && (
        <p className="import-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
