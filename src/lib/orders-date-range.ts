// Orders API uses midnight as the upper bound; the dashboard selects whole days.
export function ordersApiEndDate(inclusiveDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inclusiveDate)) return inclusiveDate;
  const date = new Date(`${inclusiveDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return inclusiveDate;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function orderInDateRange(value: string, from: string, to: string): boolean {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
  return (!from || day >= from) && (!to || day <= to);
}
