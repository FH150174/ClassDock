export interface LocalCalendarFile {
  id: string;
  name: string;
  format: "ics" | "csv";
  text: string;
  timeZone: string;
  importedAt: string;
}
export interface ManualCourse {
  id: string;
  title: string;
  date: string;
  start: string;
  end: string;
  location: string;
  timeZone: string;
  weeklyUntil?: string;
}
export interface LocalCalendarData {
  version: 1;
  mode: "mock" | "local";
  files: LocalCalendarFile[];
  manual: ManualCourse[];
  updatedAt: string;
}
