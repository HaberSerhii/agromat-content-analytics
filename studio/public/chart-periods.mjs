const DAY = 86400000;
const iso = (date) => new Date(date).toISOString().slice(0, 10);
export const addDays = (date, n) => iso(Date.parse(date) + n * DAY);
export function yearBefore(date) {
  const [y, m, d] = date.split("-").map(Number);
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(m === 2 && d === 29 ? 28 : d).padStart(2, "0")}`;
}
export function graphRange(today, preset = "month") {
  const to = addDays(today, -1),
    date = new Date(to + "T00:00:00Z");
  if (preset === "week") return { from: addDays(to, -6), to };
  if (preset === "quarter")
    return {
      from: `${date.getUTCFullYear()}-${String(Math.floor(date.getUTCMonth() / 3) * 3 + 1).padStart(2, "0")}-01`,
      to,
    };
  if (preset === "year") return { from: to.slice(0, 4) + "-01-01", to };
  return { from: to.slice(0, 7) + "-01", to };
}
export const miniInterval = (range) =>
  (Date.parse(range.to) - Date.parse(range.from)) / DAY + 1 <= 40
    ? "day"
    : "week";
export function graphBins(today, preset = "month") {
  return calendarBins(
    graphRange(today, preset),
    ["quarter", "year"].includes(preset) ? "week" : "day",
  );
}
export function calendarBins(range, interval = "day") {
  const rows = [];
  for (let from = range.from; from <= range.to; ) {
    const date = new Date(from + "T00:00:00Z"),
      days = interval === "day" ? 0 : 6 - ((date.getUTCDay() + 6) % 7);
    const to = addDays(from, days) > range.to ? range.to : addDays(from, days);
    const thursday = new Date(from + "T00:00:00Z");
    thursday.setUTCDate(
      thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7),
    );
    const isoYear = thursday.getUTCFullYear(),
      week = Math.ceil(((thursday - Date.UTC(isoYear, 0, 1)) / DAY + 1) / 7);
    rows.push({
      from,
      to,
      year: Number(from.slice(0, 4)),
      week,
      interval,
      label:
        interval === "day"
          ? from.slice(8) + "." + from.slice(5, 7)
          : "Т" + week,
      previousFrom: yearBefore(from),
      previousTo: yearBefore(to),
    });
    from = addDays(to, 1);
  }
  return rows;
}
export function userGraphBins(today) {
  const unique = new Map();
  for (const preset of ["week", "month", "quarter", "year"])
    for (const bin of graphBins(today, preset))
      for (const [from, to] of [
        [bin.from, bin.to],
        [bin.previousFrom, bin.previousTo],
      ])
        unique.set(from + ":" + to, { key: from + ":" + to, from, to });
  return [...unique.values()];
}

export function calendarUserBins(range) {
  const unique = new Map();
  for (const interval of ["day", "week"])
    for (const bin of calendarBins(range, interval))
      for (const [from, to] of [
        [bin.from, bin.to],
        [bin.previousFrom, bin.previousTo],
      ])
        unique.set(from + ":" + to, { key: from + ":" + to, from, to });
  return [...unique.values()];
}

/** The most recent 13 complete Monday–Sunday weeks, independent of KPI dates. */
export function lastQuarterWeeks(today) {
  const yesterday = addDays(today, -1);
  const to = addDays(
    yesterday,
    -new Date(yesterday + "T00:00:00Z").getUTCDay(),
  );
  return { from: addDays(to, -90), to };
}
