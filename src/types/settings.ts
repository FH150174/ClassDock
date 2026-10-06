export type Theme = "system" | "light" | "dark";
export interface WidgetSettings {
  theme: Theme;
  opacity: number;
  alwaysOnTop: boolean;
  locked: boolean;
}
