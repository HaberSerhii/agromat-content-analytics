import { yearBefore } from "./public/chart-periods.mjs";
export function waterfallComparison(range, mode = "yoy") {
  if (mode === "yoy")
    return { from: yearBefore(range.from), to: yearBefore(range.to) };
  const shift = (value, end = false) => {
    const [year, month, day] = value.split("-").map(Number),
      last = new Date(Date.UTC(year, month - 1, 0)).getUTCDate(),
      currentLast = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return new Date(
      Date.UTC(
        year,
        month - 2,
        end && day === currentLast ? last : Math.min(day, last),
      ),
    )
      .toISOString()
      .slice(0, 10);
  };
  return { from: shift(range.from), to: shift(range.to, true) };
}
const metric = (source, key) =>
  source?.available && Number.isFinite(source.metrics?.[key])
    ? source.metrics[key]
    : null;
const traffic = (source) =>
  source?.available
    ? source.rows.reduce(
        (sum, row) => ({
          sessions: sum.sessions + (Number(row.sessions) || 0),
          purchases: sum.purchases + (Number(row.purchases) || 0),
        }),
        { sessions: 0, purchases: 0 },
      )
    : null;
export function revenueWaterfall(
  current,
  previous,
  range,
  comparisonRange,
  mode = "yoy",
) {
  const start = metric(previous.all, "shippedRevenue"),
    end = metric(current.all, "shippedRevenue");
  const s0 = metric(previous.site, "shippedRevenue"),
    s1 = metric(current.site, "shippedRevenue"),
    docs0 = metric(previous.site, "shippedDocs"),
    docs1 = metric(current.site, "shippedDocs");
  const r0 = metric(previous.rozetka, "shippedRevenue"),
    r1 = metric(current.rozetka, "shippedRevenue"),
    m0 = metric(previous.monomarket, "shippedRevenue"),
    m1 = metric(current.monomarket, "shippedRevenue");
  const t0 = traffic(previous.traffic),
    t1 = traffic(current.traffic);
  if (
    [start, end, s0, s1, r0, r1, m0, m1].some((value) => value === null) ||
    !t0 ||
    !t1 ||
    !docs0 ||
    !docs1 ||
    !t0.sessions ||
    !t1.sessions ||
    !t0.purchases ||
    !t1.purchases ||
    !(s0 > 0)
  )
    return {
      available: false,
      range,
      comparisonRange,
      mode,
      notice:
        "Немає повної порівнюваної бази ERP та GA4 для факторного аналізу.",
    };
  const a0 = s0 / docs0,
    a1 = s1 / docs1,
    c0 = t0.purchases / t0.sessions,
    c1 = t1.purchases / t1.sessions;
  const afterTraffic = (s0 * t1.sessions) / t0.sessions,
    afterConversion = (afterTraffic * c1) / c0,
    afterAov = (afterConversion * a1) / a0;
  const factors = [
    { key: "traffic", label: "Трафік", value: afterTraffic - s0 },
    {
      key: "conversion",
      label: "Конверсія",
      value: afterConversion - afterTraffic,
    },
    { key: "aov", label: "Чек", value: afterAov - afterConversion },
    { key: "reconcile", label: "Різниця в обліку", value: s1 - afterAov },
    { key: "marketplaces", label: "Маркетплейси", value: r1 + m1 - r0 - m0 },
    {
      key: "other",
      label: "Інші канали",
      value: end - s1 - r1 - m1 - (start - s0 - r0 - m0),
    },
  ].filter((factor) => Math.abs(factor.value) > 0.005);
  let running = start;
  const steps = factors.map((factor) => {
    const from = running;
    running += factor.value;
    return { ...factor, from, to: running };
  });
  return {
    available: true,
    range,
    comparisonRange,
    mode,
    start,
    end,
    steps,
    residual: end - running,
    updatedAt: new Date().toISOString(),
  };
}
export async function loadRevenueWaterfall(range, mode, load) {
  const comparisonRange = waterfallComparison(range, mode);
  const pack = async (period) => {
    const [all, site, rozetka, monomarket, web] = await Promise.all([
      ...["all", "site", "rozetka", "monomarket"].map((channel) =>
        load("sales", new URLSearchParams({ channel }), period),
      ),
      load("channels", new URLSearchParams(), period),
    ]);
    return { all, site, rozetka, monomarket, traffic: web };
  };
  const [current, previous] = await Promise.all([
    pack(range),
    pack(comparisonRange),
  ]);
  return revenueWaterfall(current, previous, range, comparisonRange, mode);
}
