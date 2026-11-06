export function monthlyPeriods(to: string, count: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) return [];
  const end = new Date(`${to}T00:00:00Z`);
  if (!Number.isFinite(end.getTime())) return [];
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - count + 1 + index, 1));
    const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    return { from: start.toISOString().slice(0, 10), to: index === count - 1 ? to : last.toISOString().slice(0, 10) };
  });
}

export function priorYearDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const last = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
  return `${year - 1}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

export function revenueChange(current: number, previous: number) {
  return previous === 0 ? null : (current - previous) / Math.abs(previous) * 100;
}

export function salesCsv(rows: (string | number)[][]) {
  return "\uFEFF" + rows.map(row => row.map(cell => {
    const value = String(cell);
    return `"${(/^[=+@\-]/.test(value) && typeof cell === "string" ? "'" + value : value).replaceAll('"', '""')}"`;
  }).join(";")).join("\r\n");
}
