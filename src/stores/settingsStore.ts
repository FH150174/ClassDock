import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { WidgetSettings } from "../types/settings";

interface SettingsState {
  settings: WidgetSettings;
  update: (patch: Partial<WidgetSettings>) => void;
}
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      settings: {
        theme: "system",
        opacity: 92,
        alwaysOnTop: false,
        locked: false,
      },
      update: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),
    }),
    { name: "classdock-settings", version: 1 },
  ),
);
