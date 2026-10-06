import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DateTime } from "luxon";
import {
  googleService,
  googleMessage,
  desktopClientJson,
  GOOGLE_EVENT,
  type GoogleStatus,
  type GoogleCalendar,
} from "../services/googleCalendarService";
import { useLocalCalendarStore } from "../stores/localCalendarStore";
import { useCalendarStore } from "../stores/calendarStore";

export function GoogleSources() {
  const native = isTauri();
  const alive = useRef(false);
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [selected, setSelected] = useState("");
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    if (!native)
      return () => {
        disposed = true;
        alive.current = false;
      };
    let unlisten: (() => void) | undefined;
    const reload = async () => {
      try {
        const current = await googleService.status();
        if (!disposed) setStatus(current);
      } catch (e) {
        if (!disposed) setError(googleMessage(e));
      }
    };
    void reload();
    void listen(GOOGLE_EVENT, () => void reload())
      .then((stop) => {
        if (!disposed) unlisten = stop;
        else stop();
      })
      .catch((e) => {
        if (!disposed) setError(googleMessage(e));
      });
    return () => {
      disposed = true;
      alive.current = false;
      unlisten?.();
    };
  }, [native]);
  const operate = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      if (alive.current) setError(googleMessage(e));
    } finally {
      if (alive.current) setBusy("");
    }
  };
  const list = async () => {
    const items = await googleService.calendars();
    if (!alive.current) return;
    setCalendars(items);
    setSelected((current) =>
      items.some((item) => item.id === current)
        ? current
        : (items.find((item) => item.id === status?.selectedCalendarId)?.id ??
          items.find((item) => item.primary)?.id ??
          items[0]?.id ??
          ""),
    );
    if (!items.length) setNotice("此账号没有可读取的日历。");
  };
  const refreshWidget = async () => {
    await useCalendarStore.getState().refresh();
    const result = useCalendarStore.getState();
    if (result.error) throw new Error(result.error);
  };
  const disabled = !native || !!busy || !!status?.authorizing;
  return (
    <section className="settings-section course-sources google-sources">
      <h2>Google 日历</h2>
      <p className="source-description">
        登录账号、选择一个日历，与本地课程一起显示。连接后每 10 分钟同步一次。
      </p>
      {!native && (
        <p className="source-notice">
          Google 账号登录需要使用 Windows 桌面应用。
        </p>
      )}
      <details className="source-details">
        <summary>
          配置 Google 登录{status?.configured ? " · 已保存" : " · 首次使用必填"}
        </summary>
        <p>
          在 Google Cloud 启用 Calendar API，配置 OAuth
          同意屏幕（测试状态时添加自己的账号），创建“桌面应用”OAuth 客户端并下载
          JSON。
        </p>
        <label className="setting-label" htmlFor="google-json">
          导入桌面 OAuth JSON
        </label>
        <input
          id="google-json"
          type="file"
          accept=".json,application/json"
          disabled={disabled || status?.connected}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (!file) return;
            void operate("读取配置", async () => {
              if (file.size > 32768)
                throw new Error("OAuth 配置文件不能超过 32 KB");
              const client = desktopClientJson(await file.text());
              if (alive.current) {
                setClientId(client.clientId);
                setSecret(client.clientSecret);
                setNotice("配置已填入，请保存后登录。");
              }
            });
          }}
        />
        <div className="google-fields">
          <label>
            Client ID
            <input
              value={clientId}
              autoComplete="off"
              spellCheck={false}
              placeholder="…apps.googleusercontent.com"
              disabled={disabled || status?.connected}
              onChange={(e) => setClientId(e.target.value)}
            />
          </label>
          <label>
            客户端密钥（若 JSON 中提供）
            <input
              type="password"
              autoComplete="off"
              value={secret}
              disabled={disabled || status?.connected}
              onChange={(e) => setSecret(e.target.value)}
            />
          </label>
        </div>
        <button
          className="source-button"
          disabled={disabled || status?.connected || !clientId.trim()}
          onClick={() =>
            void operate("保存配置", async () => {
              const current = await googleService.configure(
                clientId.trim(),
                secret.trim(),
              );
              if (alive.current) {
                setStatus(current);
                setSecret("");
                setNotice("配置已保存到 Windows 凭据管理器，可以登录了。");
              }
            })
          }
        >
          保存 OAuth 配置
        </button>
        {status?.connected && <p>更换 OAuth 客户端前，请先退出当前连接。</p>}
      </details>
      <div className="import-actions">
        <button
          className="source-button"
          disabled={disabled || !status?.configured}
          onClick={() =>
            void operate("等待 Google 授权", async () => {
              const current = await googleService.connect();
              if (!alive.current) return;
              setStatus(current);
              setCalendars([]);
              setSelected("");
              await refreshWidget();
              await list();
              if (alive.current) setNotice("登录成功，请选择日历并点击导入。");
            })
          }
        >
          {status?.connected ? "重新登录 / 更换账号" : "登录 Google"}
        </button>
        {(busy === "等待 Google 授权" || status?.authorizing) && (
          <button
            className="source-button"
            onClick={() =>
              void googleService
                .cancel()
                .catch((e) => setError(googleMessage(e)))
            }
          >
            取消登录
          </button>
        )}
        {status?.connected && (
          <button
            className="source-button"
            disabled={disabled}
            onClick={() => void operate("读取日历", list)}
          >
            读取日历列表
          </button>
        )}
      </div>
      {status?.connected && (
        <>
          <label className="setting-label" htmlFor="google-calendar">
            选择要导入的日历
          </label>
          <select
            id="google-calendar"
            value={selected}
            disabled={disabled || !calendars.length}
            onChange={(e) => setSelected(e.target.value)}
          >
            {!calendars.length && (
              <option value="">先点击“读取日历列表”</option>
            )}
            {calendars.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.primary ? "（主日历）" : ""}
              </option>
            ))}
          </select>
          <div className="import-actions">
            <button
              className="source-button"
              disabled={disabled || !selected}
              onClick={() =>
                void operate("导入课程", async () => {
                  await googleService.select(selected);
                  useLocalCalendarStore.getState().setMode("local");
                  await refreshWidget();
                  if (alive.current) {
                    setStatus(await googleService.status());
                    setNotice("Google 课程已导入，并已启用自动同步。");
                  }
                })
              }
            >
              导入所选日历
            </button>
            <button
              className="source-button"
              disabled={disabled || !status.selectedCalendarId}
              onClick={() =>
                void operate("同步课程", async () => {
                  const payload = await googleService.load(true);
                  await refreshWidget();
                  if (alive.current) setStatus(await googleService.status());
                  if (payload?.warning)
                    throw new Error(payload.warning.message);
                  if (alive.current) setNotice("Google 课程已同步。");
                })
              }
            >
              立即同步
            </button>
            <button
              className="source-button"
              disabled={disabled}
              onClick={() =>
                void operate("退出连接", async () => {
                  const current = await googleService.disconnect();
                  if (alive.current) {
                    setStatus(current);
                    setCalendars([]);
                    setSelected("");
                  }
                  await refreshWidget();
                  if (current.error) throw new Error(current.error.message);
                  if (alive.current)
                    setNotice("Google 连接已退出，本地导入课程仍保留。");
                })
              }
            >
              退出 Google 连接
            </button>
          </div>
        </>
      )}
      {status?.selectedCalendarId && (
        <p className="source-description">
          当前日历：
          {calendars.find((item) => item.id === status.selectedCalendarId)
            ?.name ?? status.selectedCalendarId}
          <br />
          上次成功同步：
          {status.lastSyncTime
            ? DateTime.fromISO(status.lastSyncTime)
                .toLocal()
                .toFormat("yyyy-MM-dd HH:mm")
            : "尚未同步"}
        </p>
      )}
      {busy && (
        <p role="status" className="source-notice">
          {busy}…
          {busy === "等待 Google 授权" ? "请在系统浏览器完成登录和授权。" : ""}
        </p>
      )}
      {(error || status?.error?.message) && (
        <p role="alert" className="error-note">
          {error || status?.error?.message}
        </p>
      )}
      {notice && (
        <p role="status" className="source-notice">
          {notice}
        </p>
      )}
    </section>
  );
}
