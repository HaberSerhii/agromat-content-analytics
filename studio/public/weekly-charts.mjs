import { graphBins, calendarBins } from "./chart-periods.mjs?v=fastoverview2";
import {comparisonRange,addDays,rangeDays} from './overview-filters.mjs';
const DAY = 86400000;
const esc = (v) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const iso = (d) => new Date(d).toISOString().slice(0, 10);
export function isoWeek(date) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  return { year, week: Math.ceil(((d - Date.UTC(year, 0, 1)) / DAY + 1) / 7) };
}
export function weekMonday(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  return iso(
    jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY + (week - 1) * 7 * DAY,
  );
}
const plus = (date, n) => iso(Date.parse(date) + n * DAY);
const key = (year, week) => `${year}${String(week).padStart(2, "0")}`;
function bins(from, to) {
  const first = isoWeek(from),
    start = weekMonday(first.year, first.week),
    rows = [];
  for (let date = start; date <= to; date = plus(date, 7)) {
    const item = isoWeek(date);
    rows.push({
      ...item,
      from: date,
      to: plus(date, 6),
      label: "Т" + item.week,
    });
  }
  return rows;
}
export function historySeries(history, metric, mini = false) {
  if (!history?.range) return [];
  const selection = mini && typeof mini === "object" ? mini : null;
  const userPeriods = new Map(
    (history.users?.periods || []).map((row) => [row.key, row]),
  );
  const webDays = new Map(
    (history.web?.days || []).map((row) => [row.date, row]),
  );
  const webDates = [...webDays.keys()].sort();
  const webPeriods=new Map((history.web?.periods||[]).map(row=>[row.key,row]));
  const range = history.range,
    year = Number(range.to.slice(0, 4));
  const daily = new Map();
  for (const source of history.sales || [])
    if (source.available)
      for (const row of source.days || [])
        if (source.coverageFrom && row.date >= source.coverageFrom)
          daily.set(row.date, row);
  const users = new Map(
    (history.users?.available ? history.users.weeks || [] : []).map((r) => {
      const w = isoWeek(r.week);
      return [key(w.year, w.week), r.users];
    }),
  );
  const coverage = new Map(
    (history.users?.weeks || []).map((row) => {
      const week = isoWeek(row.week);
      return [key(week.year, week.week), row.dataThrough];
    }),
  );
  const web = new Map(
    (history.web?.available ? history.web.weeks || [] : []).map((r) => [
      r.isoWeek,
      r,
    ]),
  );
  function value(row) {
    if (selection && metric === "users") {
      const period = userPeriods.get(row.from + ":" + row.to);
      return period?.hasData ? period.users : null;
    }
    if (selection && metric === "conversion") {
      const period=webPeriods.get(row.from+':'+row.to);
      if(period)return period.sessions>0?period.purchases/period.sessions*100:null;
      if (
        !webDates.length ||
        row.from < webDates[0] ||
        row.to > webDates.at(-1)
      )
        return null;
      let sessions = 0,
        purchases = 0;
      for (let date = row.from; date <= row.to; date = plus(date, 1)) {
        const day = webDays.get(date);
        sessions += day?.sessions || 0;
        purchases += day?.purchases || 0;
      }
      return sessions > 0 ? (purchases / sessions) * 100 : null;
    }
    const index = key(row.year, row.week);
    if (metric === "users") return users.get(index) ?? null;
    if (metric === "conversion") {
      const r = web.get(index);
      return r?.sessions > 0 ? (r.purchases / r.sessions) * 100 : null;
    }
    let revenue = 0,
      docs = 0,
      canceled = 0;
    for (let date = row.from; date <= row.to; date = plus(date, 1)) {
      const day = daily.get(date);
      if (!day) return null;
      revenue += day.revenue;
      docs += day.docs;
      if (metric === "canceled" && day.canceled == null) return null;
      canceled += day.canceled || 0;
    }
    if (metric === "aov") return docs > 0 ? revenue / docs : null;
    return { revenue, docs, canceled }[metric] ?? null;
  }
  function marginValue(bin) {
    if (!bin) return {amount:null, percent:null};
    let amount = 0, coveredRevenue = 0;
    for (let date = bin.from; date <= bin.to; date = plus(date, 1)) {
      const day = daily.get(date);
      if (day?.margin == null) return {amount:null, percent:null};
      amount += day.margin;
      coveredRevenue += day.marginCoveredRevenue;
    }
    return {amount, percent:coveredRevenue > 0 ? amount / coveredRevenue * 100 : null};
  }
  function comparisonValues(current, prior) {
    if (metric !== 'margin') return {value:value(current), previous:prior ? value(prior) : null};
    const now = marginValue(current), before = marginValue(prior);
    return {value:now.amount, previous:before.amount, marginPercent:now.percent, previousMarginPercent:before.percent};
  }
  if (selection) {
    let previousEnd;
    return (
      selection.range
        ? calendarBins(selection.range, selection.interval)
        : graphBins(selection.today, selection.preset)
    ).map((original) => {
      let row=original;
      if(selection.comparisonMode) {
        const prior=comparisonRange({from:row.from,to:row.to},selection.comparisonMode);
        if(previousEnd&&prior.from<=previousEnd)prior.from=addDays(previousEnd,1);
        previousEnd=prior.to;
        row={...row,previousFrom:prior.from,previousTo:prior.to};
      }
      const prior = row.previousFrom > row.previousTo ? null : {
        ...row, from:row.previousFrom, to:row.previousTo, year:row.year - 1,
      };
      return ({
      ...row,
      ...comparisonValues(row, prior),
      coverageThrough:
        metric === "users"
          ? userPeriods.get(row.from + ":" + row.to)?.dataThrough
          : null,
    });});
  }
  return bins(mini ? `${year}-01-01` : range.from, range.to)
    .filter((r) => !mini || r.year === year)
    .map((row) => {
      const priorFrom = weekMonday(row.year - 1, row.week),
        previous = {
          ...row,
          year: row.year - 1,
          from: priorFrom,
          to: plus(priorFrom, 6),
        };
      // ISO week 53 has no baseline in a 52-week ISO year.
      const validPrior = isoWeek(priorFrom).year === row.year - 1;
      return {
        ...row,
        ...comparisonValues(row, validPrior ? previous : null),
        previousFrom: previous.from,
        previousTo: previous.to,
        coverageThrough:
          metric === "users" ? coverage.get(key(row.year, row.week)) : null,
      };
    });
}
// Shape-preserving cubic interpolation, shared by large and miniature charts.
export function smoothPath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0].join(",")}`;
  const slope = points
    .slice(1)
    .map((p, i) => (p[1] - points[i][1]) / (p[0] - points[i][0]));
  const tangent = points.map((_, i) =>
    i === 0
      ? slope[0]
      : i === points.length - 1
        ? slope.at(-1)
        : slope[i - 1] * slope[i] <= 0
          ? 0
          : 2 / (1 / slope[i - 1] + 1 / slope[i]),
  );
  return (
    `M${points[0].join(",")}` +
    points
      .slice(1)
      .map((p, i) => {
        const h = (p[0] - points[i][0]) / 3;
        return ` C${points[i][0] + h},${points[i][1] + h * tangent[i]} ${p[0] - h},${p[1] - h * tangent[i + 1]} ${p.join(",")}`;
      })
      .join("")
  );
}
function segments(rows, field, coords) {
  const paths = [];
  let run = [];
  rows.forEach((row, i) => {
    if (row[field] != null) run.push(coords(row[field], i));
    else if (run.length) {
      paths.push(run);
      run = [];
    }
  });
  if (run.length) paths.push(run);
  return paths;
}
const fmt = (value, metric) =>
  value == null
    ? "Немає даних"
    : new Intl.NumberFormat("uk-UA", {
        maximumFractionDigits: metric === "conversion" ? 2 : 0,
      }).format(value) +
      (metric === "conversion"
        ? "%"
        : ["revenue", "aov", "margin"].includes(metric)
          ? " ₴"
          : "");
const dateLabel = (date) => date.split("-").reverse().join(".");
const marginPercentFormat = new Intl.NumberFormat("uk-UA", {maximumFractionDigits:2});
function tooltipValue(value, metric, marginPercent) {
  const formatted = fmt(value, metric);
  if (metric !== "margin" || value == null) return formatted;
  return formatted + (Number.isFinite(marginPercent) ? ` · ${marginPercentFormat.format(marginPercent)}%` : ' · —');
}

function roundStep(target, whole = true) {
  if (whole) target = Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 2.5, 5, 10].map(unit => unit * magnitude)
    .find(step => step >= target && (!whole || Number.isInteger(step)));
}

function countOrRateAxis(peak, whole) {
  const step = roundStep(peak / 4, whole);
  const intervals = Math.ceil(peak / step);
  return { max: intervals * step, ticks: Array.from({length:intervals + 1}, (_, index) => index * step) };
}

function moneyAxis(peak) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, peak)));
  const rounding = Math.max(1, peak >= 500_000 ? Math.max(500_000, magnitude / 2) : magnitude / 2);
  const max = Math.ceil(Math.max(1, peak) / rounding) * rounding;
  const step = roundStep(max / 4);
  const ticks = [];
  for (let value = 0; value < max; value += step) ticks.push(value);
  return { max, ticks: [...ticks, max] };
}

export function weeklyChart(
  history,
  metric,
  {
    mini = false,
    id = "weekly",
    compare = true,
    preset,
    today,
    range,
    interval,
    showCaption = true,
    comparisonMode,
  } = {},
) {
  const rows = historySeries(
      history,
      metric,
      range ? { range, interval, comparisonMode } : preset ? { preset, today } : mini,
    ),
    valid = rows.some((r) => r.value != null);
  if (!valid)
    return `<div class="${mini ? "bo-mini-empty" : "bo-history-empty"}">${history ? "Немає тижневої історії" : "Завантажуємо тижневу історію…"}</div>`;
  const width = mini ? 180 : 760,
    height = mini ? 49 : 285,
    left = mini ? 2 : 58,
    right = mini ? 178 : 742,
    top = mini ? 4 : 18,
    bottom = mini ? 44 : 244;
  const values = rows
      .flatMap((r) => [r.value, compare ? r.previous : null])
      .filter((v) => v != null),
    ceiling = Math.max(...values, 0.001),
    minimum = Math.min(...values),
    span = Math.max(ceiling - minimum, ceiling * 0.05),
    negativeAxis = metric === "margin" && minimum < 0 ? moneyAxis(-minimum) : null,
    floor = mini ? Math.max(negativeAxis ? -Infinity : 0, minimum - span * 0.12) : -(negativeAxis?.max || 0),
    axis = mini ? null : ["revenue", "aov", "margin"].includes(metric)
      ? moneyAxis(ceiling) : countOrRateAxis(ceiling, metric !== "conversion"),
    max = axis?.max ?? (mini ? ceiling + span * 0.12 : ceiling * 1.1);
  const coords = (v, i) => [
    left + (i * (right - left)) / Math.max(rows.length - 1, 1),
    bottom - ((v - floor) / (max - floor)) * (bottom - top),
  ];
  const current = segments(rows, "value", coords),
    prior = compare ? segments(rows, "previous", coords) : [];
  const color = metric === "canceled" ? "var(--red)" : "var(--blue)";
  const axisFormat = new Intl.NumberFormat("uk-UA", { notation: "compact", maximumFractionDigits: metric === "conversion" ? 5 : 2 });
  const zero = coords(0, 0)[1];
  const grid = mini
    ? ""
    : [...(negativeAxis?.ticks.slice(1).reverse().map(value => -value) || []), ...axis.ticks]
        .map((value) => {
          const y = coords(value, 0)[1];
          return `<path d="M${left} ${y}H${right}" class="bo-chart-grid"/><text x="${left - 9}" y="${y + 3}" text-anchor="end">${axisFormat.format(value)}${metric === "conversion" ? "%" : ""}</text>`;
        })
        .join("");
  const tick = (x, label) => `<text x="${x}" y="${bottom + 23}" text-anchor="middle">${label}</text>`;
  const calendarLabel = date => {
    const label = dateLabel(date);
    return range.from.slice(0, 4) === range.to.slice(0, 4) ? label.slice(0, 5) : label;
  };
  const middleDate = range && addDays(range.from, Math.floor((rangeDays(range) - 1) / 2));
  const ticks = mini
    ? ""
    : range
    ? [
        tick(left, calendarLabel(range.from)),
        ...(middleDate !== range.from ? [tick((left + right) / 2, calendarLabel(middleDate))] : []),
        ...(range.to === range.from ? [] : [tick(right, calendarLabel(range.to))]),
      ].join("")
    : rows
        .map((r, i) =>
          i % Math.max(1, Math.ceil(rows.length / 13)) === 0 ||
          i === rows.length - 1 ||
          r.week === 1
            ? tick(coords(0, i)[0], `${r.label}${r.week === 1 || i === 0 ? ` · ${String(r.year).slice(2)}` : ""}`)
            : "",
        )
        .join("");
  const points = rows.map((r, i) => ({
    x: coords(0, i)[0],
    y: r.value == null ? null : coords(r.value, i)[1],
    priorY: r.previous == null ? null : coords(r.previous, i)[1],
    ...r,
  }));
  const active = rows.findLast((r) => r.value != null),
    first = rows[0];
  return `<div class="bo-weekly-chart ${mini ? "is-mini" : ""}" data-weekly-chart data-metric="${metric}" data-rows="${esc(JSON.stringify(points))}" data-mini="${mini}" data-compare="${compare}" data-comparison-mode="${comparisonMode || "yoy"}"><svg preserveAspectRatio="none" viewBox="0 0 ${width} ${height}" role="img" aria-label="${preset || range ? "Вибраний період графіків" : mini ? "Поточний рік" : "Останні 52 тижні"} · ${esc(metric)} · ${rows[0]?.interval==='day'?'денне':'тижневе'} порівняння"><defs><linearGradient id="${id}-fill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="${color}" stop-opacity=".17"/><stop offset="1" stop-color="${color}" stop-opacity=".01"/></linearGradient></defs>${grid}${!mini ? current.map((p) => `<path d="${smoothPath(p)} L${p.at(-1)[0]},${zero} L${p[0][0]},${zero}Z" fill="url(#${id}-fill)"/>`).join("") : ""}${prior.map((p) => `<path d="${smoothPath(p)}" class="bo-prior-line"/>`).join("")}${current.map((p) => `<path d="${smoothPath(p)}" stroke="${color}" class="bo-current-line"/>`).join("")}${ticks}<g class="bo-chart-cursor" visibility="hidden"><path class="bo-crosshair" d="M0 ${top}V${bottom}"/><circle class="bo-focus-prior" r="3.5"/><circle class="bo-focus-now" r="4.5" stroke="${color}"/></g></svg><div class="bo-week-tooltip" role="tooltip" hidden></div>${mini ? showCaption ? `<span class="bo-mini-range">${preset || range ? `${first?.from.slice(8)}.${first?.from.slice(5, 7)}–${rows.at(-1)?.to.slice(8)}.${rows.at(-1)?.to.slice(5, 7)} · ${first?.interval === "day" ? "дні" : "тижні"}` : `${first?.year} · Т${first?.week}–Т${active?.week}`}${compare ? " · ┄ торік" : ""}</span>` : "" : `<div class="bo-week-legend"><span><i style="background:${color}"></i>${preset || range ? "Вибраний період" : "Останні 52 тижні"}</span>${compare ? `<span><i class="prior"></i>${comparisonMode === "wow" ? "Попередній тиждень" : comparisonMode === "mom" ? "Попередній місяць" : preset || range ? "Ті самі дати торік" : "Ті самі ISO-тижні торік"}</span>` : ""}</div>`}</div>`;
}
export function bindWeeklyCharts(root = document) {
  root.querySelectorAll("[data-weekly-chart]").forEach((chart) => {
    const rows = JSON.parse(chart.dataset.rows),
      svg = chart.querySelector("svg"),
      cursor = chart.querySelector(".bo-chart-cursor"),
      tooltip = chart.querySelector("[role=tooltip]"),
      metric = chart.dataset.metric,
      mini = chart.dataset.mini === "true",
      compare = chart.dataset.compare === "true",
      baselineLabel = chart.dataset.comparisonMode === "wow" ? "до попереднього тижня" : chart.dataset.comparisonMode === "mom" ? "до попереднього місяця" : "до торік";
    const show = (index) => {
      const row = rows[Math.min(rows.length - 1, Math.max(0, index))];
      const delta =
        row.value != null &&
        row.previous > 0 &&
        (!row.coverageThrough || row.coverageThrough >= row.to)
          ? (row.value / row.previous - 1) * 100
          : null;
      cursor.setAttribute("visibility", "visible");
      cursor
        .querySelector(".bo-crosshair")
        .setAttribute("transform", `translate(${row.x},0)`);
      for (const [selector, y] of [
        [".bo-focus-now", row.y],
        [".bo-focus-prior", compare ? row.priorY : null],
      ]) {
        const circle = cursor.querySelector(selector);
        circle.setAttribute("visibility", y == null ? "hidden" : "visible");
        circle.setAttribute("cx", row.x);
        circle.setAttribute("cy", y ?? 0);
      }
      tooltip.innerHTML = `<strong>${row.label} · ${row.year}</strong><small>${dateLabel(row.from)} — ${dateLabel(row.to)}</small>${row.coverageThrough && row.coverageThrough < row.to ? `<small>BigQuery: дані до ${dateLabel(row.coverageThrough)}; тиждень неповний</small>` : ""}<div><i></i><span>Поточний</span><b>${tooltipValue(row.value, metric, row.marginPercent)}</b></div>${compare ? `<div class="previous"><i></i><span>Порівняння</span><b>${tooltipValue(row.previous, metric, row.previousMarginPercent)}</b></div><small>Порівняння: ${dateLabel(row.previousFrom)} — ${dateLabel(row.previousTo)}</small><p class="${delta == null ? "" : (metric === "canceled" ? delta <= 0 : delta >= 0) ? "positive" : "negative"}">${delta == null ? "Зміна не визначена" : `${delta >= 0 ? "↗ +" : "↘ "}${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(delta)}% ${baselineLabel}`}</p>` : ""}`;
      tooltip.hidden = false;
      const rect = svg.getBoundingClientRect(),
        chartRect = chart.getBoundingClientRect(),
        pixelX = (row.x / svg.viewBox.baseVal.width) * rect.width;
      const tipWidth = tooltip.offsetWidth;
      tooltip.style.position = mini ? "fixed" : "absolute";
      tooltip.style.left =
        (mini
          ? Math.min(
              Math.max(8, rect.left + pixelX - tipWidth / 2),
              window.innerWidth - tipWidth - 8,
            )
          : Math.min(
              Math.max(0, pixelX - tipWidth / 2),
              Math.max(0, chartRect.width - tipWidth),
            )) + "px";
      tooltip.style.top = mini
        ? Math.min(
            rect.bottom + 10,
            window.innerHeight - tooltip.offsetHeight - 8,
          ) + "px"
        : "24px";
    };
    const hide = () => {
      cursor.setAttribute("visibility", "hidden");
      tooltip.hidden = true;
    };
    svg.addEventListener("pointermove", (event) => {
      const box = svg.getBoundingClientRect(),
        x =
          ((event.clientX - box.left) / box.width) * svg.viewBox.baseVal.width;
      show(
        rows.reduce(
          (best, row, i) =>
            Math.abs(row.x - x) < Math.abs(rows[best].x - x) ? i : best,
          0,
        ),
      );
    });
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("click", (event) => event.stopPropagation());
    svg.tabIndex = 0;
    let index = rows.length - 1;
    svg.addEventListener("focus", () => show(index));
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hide();
      if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        index = Math.max(
          0,
          Math.min(
            rows.length - 1,
            index + (event.key === "ArrowLeft" ? -1 : 1),
          ),
        );
        show(index);
      }
    });
  });
}
