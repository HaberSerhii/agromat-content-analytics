const DAY = 86400000;
export function defaultRange(today) {
  const to = new Date(Date.parse(today) - DAY).toISOString().slice(0, 10);
  // On the first day, show the last completed month.
  return { from: `${to.slice(0, 7)}-01`, to };
}
export function intervalFor(from, to, selected = "day") {
  return ["day", "week", "month"].includes(selected) ? selected : "day";
}
export function yearBefore(date) {
  const [y, m, d] = date.split("-").map(Number);
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(m === 2 && d === 29 ? 28 : d).padStart(2, "0")}`;
}
const month = (d) =>
  new Date(`${d.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("uk-UA", {
    month: "long",
    timeZone: "UTC",
  });
export function chartSeries(data, range, compare) {
  const interval = intervalFor(range.from, range.to, range.chartInterval);
  const prior =
    compare && data.previous?.available && data.previous.hasData
      ? data.previous
      : null;
  const metric = range.chartMetric === "docs" ? "docs" : "revenue";
  const currentMap = new Map(
    (interval === "month" ? data.months || [] : data.byDate || []).map((r) => [
      r.month || r.date,
      Number(r[metric]) || 0,
    ]),
  );
  const priorMap = new Map(
    (interval === "month" ? prior?.months : prior?.byDate || [])?.map((r) => [
      r.month || r.date,
      Number(r[metric]) || 0,
    ]) || [],
  );
  const bins = new Map();
  for (let t = Date.parse(range.from); t <= Date.parse(range.to); t += DAY) {
    const date = new Date(t).toISOString().slice(0, 10),
      dt = new Date(t);
    const firstDay =
      (new Date(`${date.slice(0, 7)}-01T00:00:00Z`).getUTCDay() + 6) % 7;
    const week = Math.ceil((dt.getUTCDate() + firstDay) / 7);
    const key =
      interval === "month"
        ? date.slice(0, 7)
        : interval === "week"
          ? `${date.slice(0, 7)}-w${week}`
          : date;
    let b = bins.get(key);
    if (!b) {
      b = {
        key,
        from: date,
        to: date,
        value: 0,
        previous: prior ? 0 : null,
        label:
          interval === "month"
            ? `${month(date)} ${date.slice(0, 4)}`
            : interval === "week"
              ? `${month(date)} · тиждень ${week}`
              : date.split("-").reverse().join("."),
      };
      bins.set(key, b);
    }
    b.to = date;
    if (interval !== "month") {
      b.value += currentMap.get(date) || 0;
      if (prior) b.previous += priorMap.get(yearBefore(date)) || 0;
    }
  }
  for (const b of bins.values())
    if (interval === "month") {
      b.value = currentMap.get(b.key) || 0;
      b.previous = prior
        ? priorMap.get(yearBefore(b.from).slice(0, 7)) || 0
        : null;
    }
  return { interval, rows: [...bins.values()] };
}
