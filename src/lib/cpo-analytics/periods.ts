import type { CpoPeriodAvailability, CpoPeriodKind, CpoPeriodRange } from "./types";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

export function isoWeekNumber(value: string): { year: number; week: number } {
  const date = new Date(`${value}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const year = date.getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1, 12));
  return { year, week: Math.ceil((((date.getTime() - start.getTime()) / 86_400_000) + 1) / 7) };
}

export function isoWeekStart(year: number, week: number): string {
  const fourth = new Date(Date.UTC(year, 0, 4, 12));
  const day = fourth.getUTCDay() || 7;
  fourth.setUTCDate(fourth.getUTCDate() - day + 1 + (week - 1) * 7);
  return isoDate(fourth);
}

function weeksInYear(year: number): number {
  return isoWeekNumber(`${year}-12-28`).week;
}

function monthRange(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  return { from, to: isoDate(new Date(Date.UTC(year, month, 0, 12))) };
}

export function cpoPeriodRanges(kind: CpoPeriodKind, value: number, year: number): CpoPeriodRange[] {
  if (kind === "week") {
    if (!Number.isInteger(value) || value < 1 || value > weeksInYear(year)) throw new Error("Некоректний номер тижня");
    const currentFrom = isoWeekStart(year, value);
    const previousFrom = shiftDays(currentFrom, -7);
    const previousIdentity = isoWeekNumber(previousFrom);
    const yearAgoWeek = Math.min(value, weeksInYear(year - 1));
    const yearAgoFrom = isoWeekStart(year - 1, yearAgoWeek);
    return [
      { key: "current", label: `Тиждень ${value}, ${year}`, from: currentFrom, to: shiftDays(currentFrom, 6), year, number: value },
      { key: "previous", label: `Тиждень ${previousIdentity.week}, ${previousIdentity.year}`, from: previousFrom, to: shiftDays(previousFrom, 6), year: previousIdentity.year, number: previousIdentity.week },
      { key: "yearAgo", label: `Тиждень ${yearAgoWeek}, ${year - 1}`, from: yearAgoFrom, to: shiftDays(yearAgoFrom, 6), year: year - 1, number: yearAgoWeek },
    ];
  }
  if (!Number.isInteger(value) || value < 1 || value > 12) throw new Error("Некоректний номер місяця");
  const current = monthRange(year, value);
  const previousYear = value === 1 ? year - 1 : year;
  const previousMonth = value === 1 ? 12 : value - 1;
  const previous = monthRange(previousYear, previousMonth);
  const yearAgo = monthRange(year - 1, value);
  const label = (from: string) => {
    const text = new Intl.DateTimeFormat("uk-UA", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${from}T12:00:00Z`));
    return text.charAt(0).toUpperCase() + text.slice(1);
  };
  return [
    { key: "current", label: label(current.from), ...current, year, number: value },
    { key: "previous", label: label(previous.from), ...previous, year: previousYear, number: previousMonth },
    { key: "yearAgo", label: label(yearAgo.from), ...yearAgo, year: year - 1, number: value },
  ];
}

export function currentKyivIdentity(): { date: string; year: number; week: number; month: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const week = isoWeekNumber(date);
  return { date, year: Number(parts.year), week: week.week, month: Number(parts.month) };
}

export function availableCpoPeriods(
  metadata: { savedAt: string; dataFrom: string; dataTo: string },
  periodKeys: string[],
  today = currentKyivIdentity().date,
): CpoPeriodAvailability {
  const periods: CpoPeriodAvailability["periods"] = { week: [], month: [] };
  for (const key of new Set(periodKeys)) {
    const match = /^(week|month)-(\d{4})-(\d{1,2})$/.exec(key);
    if (!match) continue;
    const kind = match[1] as CpoPeriodKind;
    const year = Number(match[2]);
    const number = Number(match[3]);
    if (number < 1 || number > (kind === "week" ? weeksInYear(year) : 12)) continue;
    const range = cpoPeriodRanges(kind, number, year)[0];
    if (range.from >= metadata.dataFrom && range.to <= metadata.dataTo && range.to < today) {
      periods[kind].push(range);
    }
  }
  for (const kind of ["week", "month"] as const) periods[kind].sort((a, b) => b.from.localeCompare(a.from));
  return { savedAt: metadata.savedAt, dataFrom: metadata.dataFrom, dataTo: metadata.dataTo, periods };
}
