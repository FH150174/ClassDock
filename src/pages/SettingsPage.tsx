import { CourseSources } from "../components/CourseSources";
import { version } from "../../package.json";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Monitor,
  Moon,
  Sun,
  CalendarDays,
} from "lucide-react";
import { useSettingsStore } from "../stores/settingsStore";
import type { Theme } from "../types/settings";

export function SettingsPage({ onBack }: { onBack?: () => void }) {
  const scrollArea = useRef<HTMLElement>(null);
  useAutoHideScrollbar(scrollArea);
  const { settings, update } = useSettingsStore();
  const themes: { value: Theme; name: string; icon: typeof Sun }[] = [
    { value: "light", name: "浅色", icon: Sun },
    { value: "dark", name: "深色", icon: Moon },
    { value: "system", name: "跟随系统", icon: Monitor },
  ];
  return (
    <main className="settings-page auto-hide-scroll" ref={scrollArea}>
      <header className="settings-heading">
        {onBack && (
          <button
            className="icon-button"
            onClick={onBack}
            aria-label="返回课程表"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <div>
          <p className="eyebrow">CLASSDOCK</p>
          <h1>让课表，适合你</h1>
        </div>
      </header>
      <CourseSources />
      <section className="settings-section">
        <h2>外观</h2>
        <label className="setting-label">主题</label>
        <div className="theme-options">
          {themes.map(({ value, name, icon: Icon }) => (
            <button
              key={value}
              className={settings.theme === value ? "selected" : ""}
              aria-pressed={settings.theme === value}
              onClick={() => update({ theme: value })}
            >
              <Icon size={19} />
              <span>{name}</span>
              {settings.theme === value && <Check size={12} />}
            </button>
          ))}
        </div>
        <label className="range-label" htmlFor="opacity">
          背景不透明度 <span>{settings.opacity}%</span>
        </label>
        <input
          id="opacity"
          type="range"
          min="55"
          max="100"
          value={settings.opacity}
          onChange={(event) => update({ opacity: Number(event.target.value) })}
        />
      </section>
      <section className="settings-section">
        <h2>桌面窗口</h2>
        <label className="toggle-row">
          <span>
            <strong>始终置顶</strong>
            <small>让课程表保持在其他窗口上方</small>
          </span>
          <input
            type="checkbox"
            checked={settings.alwaysOnTop}
            onChange={(event) => update({ alwaysOnTop: event.target.checked })}
          />
        </label>
        <label className="toggle-row">
          <span>
            <strong>锁定位置</strong>
            <small>防止拖动时意外移动</small>
          </span>
          <input
            type="checkbox"
            checked={settings.locked}
            onChange={(event) => update({ locked: event.target.checked })}
          />
        </label>
      </section>
      <section className="settings-section">
        <h2>Google Calendar</h2>
        <div className="connection-note">
          <CalendarDays size={22} />
          <div>
            <strong>Google 同步待接入</strong>
            <p>
              现在可导入本地 ICS、CSV 或手动添加课程；Google
              登录与同步将在后续接入。
            </p>
          </div>
        </div>
        <a
          className="docs-link"
          href="https://developers.google.com/identity/protocols/oauth2/native-app"
          target="_blank"
          rel="noreferrer"
        >
          桌面 OAuth 接入文档 <ExternalLink size={13} />
        </a>
      </section>
      <p className="settings-footnote">
        ClassDock {version} · 本地课程版
        <br />
        开机启动、自动同步与提醒尚未启用。
      </p>
    </main>
  );
}
import { useRef } from "react";
import { useAutoHideScrollbar } from "../hooks/useAutoHideScrollbar";
