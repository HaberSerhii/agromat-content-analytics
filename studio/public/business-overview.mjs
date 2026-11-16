import {renderSiteFunnel} from "./site-funnel.mjs?v=ga4fallback1";
import { categoryMosaic, categoryPeriod } from "./category-treemap.mjs?v=ga4fallback1";
import {
  graphRange,
  yearBefore,
  miniInterval,
  lastQuarterWeeks,
  calendarBins,
} from "./chart-periods.mjs?v=ga4fallback1";
import { weeklyChart, historySeries } from "./weekly-charts.mjs?v=ga4fallback1";
import { chartSeries, defaultRange } from "./chart-data.mjs?v=salesfilters1";
const esc = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const number = (value) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(
        value,
      );
const short = (value) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("uk-UA", {
        notation: "compact",
        maximumFractionDigits: 2,
      }).format(value);
const money = (value) => (value == null ? "—" : `${short(value)} ₴`);
const percent = (value) =>
  value == null
    ? "—"
    : `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(value)}%`;
const available = (source) => source?.available === true;
const sum = (rows, key) =>
  (rows || []).reduce((total, row) => total + (Number(row[key]) || 0), 0);
const ratio = (a, b, factor = 1) =>
  Number.isFinite(a) && b > 0 ? (a / b) * factor : null;
const change = (now, prior) =>
  ratio(now, prior, 100) == null ? null : (now / prior) * 100 - 100;
const colors = ["#533afd", "#8d7afb", "#baaefa", "#ddd6fc"];
export const presetRange = graphRange;
export function overviewModel(data, state) {
  const sales = available(data.chartSales)
    ? data.chartSales
    : state.chartChannel === "all" &&
        state.chartSegment === "Усі" &&
        available(data.sales)
      ? data.sales
      : null;
  const m = sales?.metrics || {},
    p =
      state.yoy && available(sales?.previous) && sales.previous.hasData
        ? sales.previous.metrics
        : {};
  const dailyTotals = (from,to) => {
    const web=data.history?.web;
    if(!web?.available || web.incomplete || web.thresholded)return null;
    const rows=web.days.filter(row=>row.date>=from&&row.date<=to);
    const expected=(Date.parse(to)-Date.parse(from))/86400000+1;
    if(rows.length!==expected || new Set(rows.map(row=>row.date)).size!==expected || rows.some(row=>!Number.isFinite(row.sessions)||!Number.isFinite(row.purchases)||row.sessions<0||row.purchases<0))return null;
    return {available:true,rows:[{sessions:sum(rows,'sessions'),purchases:sum(rows,'purchases')}]};
  };
  const channel = available(data.channels) ? data.channels : (()=>{
    const current=dailyTotals(state.from,state.to);
    return current?{...current,previous:dailyTotals(yearBefore(state.from),yearBefore(state.to))}:null;
  })();
  const previousChannel =
    state.yoy && available(channel?.previous) ? channel.previous : null;
  const metric = (key, label, value, prior, format, hint, lower = false) => ({
    key,
    label,
    value,
    prior,
    format,
    hint,
    lower,
    delta: change(value, prior),
  });
  const metrics = [
    metric(
      "revenue",
      "Виторг",
      m.shippedRevenue ?? null,
      p.shippedRevenue,
      money,
      "Відвантажені продажі · ERP",
    ),
    metric(
      "docs",
      "Замовлення",
      m.shippedDocs ?? null,
      p.shippedDocs,
      number,
      "Відвантажені замовлення · ERP",
    ),
    metric(
      "aov",
      "Середній чек",
      ratio(m.shippedRevenue, m.shippedDocs),
      ratio(p.shippedRevenue, p.shippedDocs),
      money,
      "Виторг / відвантажені замовлення",
    ),
    metric(
      "users",
      "Користувачі · Україна",
      data.users?.available ? data.users.users : null,
      state.yoy &&
        data.users?.previous?.available &&
        data.users.previous.hasData
        ? data.users.previous.users
        : null,
      short,
      "Унікальні за період · BigQuery · UA",
    ),
    metric(
      "conversion",
      "Конверсія",
      channel
        ? ratio(
            sum(channel.rows, "purchases"),
            sum(channel.rows, "sessions"),
            100,
          )
        : null,
      previousChannel
        ? ratio(
            sum(previousChannel.rows, "purchases"),
            sum(previousChannel.rows, "sessions"),
            100,
          )
        : null,
      percent,
      "Покупки / сеанси · GA4",
    ),
    metric(
      "canceled",
      "Скасування",
      m.canceledDocs ?? null,
      p.canceledDocs,
      number,
      "Скасовані документи · ERP",
      true,
    ),
  ];
  const channels = ["site", "rozetka", "monomarket"].map((id, i) => {
    const source = data.salesChannels?.[id];
    return {
      id,
      name: ["Сайт", "Rozetka", "Monomarket"][i],
      color: colors[i],
      source,
      value: available(source)
        ? (source.metrics?.shippedRevenue ?? null)
        : null,
      prior:
        state.yoy && available(source?.previous) && source.previous.hasData
          ? source.previous.metrics?.shippedRevenue
          : null,
    };
  });
  return {
    sales,
    metrics,
    channels,
    total: available(data.sales) ? data.sales.metrics?.shippedRevenue : null,
  };
}
function badge(delta, lower = false) {
  if (delta == null) return '<span class="bo-delta neutral">Немає бази</span>';
  return `<span class="bo-delta ${(lower ? delta <= 0 : delta >= 0) ? "positive" : "negative"}">${delta >= 0 ? "↗" : "↘"} ${percent(Math.abs(delta))}</span>`;
}
function card(id, title, sub, body, extra = "", cls = "") {
  return `<section class="bo-card ${cls}" id="bo-${id}" tabindex="-1"><header><div><h2>${title}</h2><p>${sub}</p></div>${extra}</header>${body}</section>`;
}
function empty(text) {
  return `<div class="bo-empty"><span>↗</span><p>${text}</p></div>`;
}
function channelPanel(model, state) {
  const valid = model.channels.filter((c) => c.value != null),
    known = sum(valid, "value");
  const total = model.total;
  const residual = total != null ? total - known : 0;
  const complete = valid.length === 3 && total > 0 && residual >= -0.01;
  const rows =
    complete && residual > 0.01
      ? [
          ...valid,
          {
            name: "Інші / не визначено",
            value: residual,
            prior: null,
            color: colors[3],
          },
        ]
      : valid;
  rows.splice(2, 0, {id:"prom",name:"Prom",value:0,prior:null,color:colors[3]});
  let offset = 0;
  const segments = complete
    ? rows
        .map((c) => {
          const start = offset;
          offset += (c.value / total) * 100;
          return `${c.color} ${start}% ${offset}%`;
        })
        .join(",")
    : "var(--line) 0% 100%";
  return card(
    "channels",
    "Канали продажу",
    "Відвантажений виторг · ERP",
    `<div class="bo-channel-layout"><div class="bo-donut" style="background:conic-gradient(${segments})"><div><strong>${money(total)}</strong><small>${complete ? "усі канали" : "неповна розбивка"}</small></div></div><div class="bo-channel-list">${rows.map((c) => `<button data-bo-channel="${c.id || "all"}"><span class="bo-dot" style="background:${c.color}"></span><span>${esc(c.name)}<small>${money(c.value)}</small></span><b>${complete ? percent((c.value / total) * 100) : "—"}</b>${state.yoy ? badge(change(c.value, c.prior)) : ""}</button>`).join("")}</div></div><p class="bo-footnote">Prom поки 0% · окрема статистика ще не надходить.${!complete ? " Частки недоступні без повної розбивки." : ""}</p>`,
  );
}
export function quarterChannelRows(data, today) {
  const range = lastQuarterWeeks(today),
    rows = calendarBins(range, "week");
  const channels = ["site", "rozetka", "monomarket"].map((id, index) => ({
    id,
    name: ["Сайт", "Rozetka", "Monomarket"][index],
    color: colors[index],
    source: data.quarterChannels?.[id],
  }));
  for (const channel of channels) {
    const daily = new Map(
      (channel.source?.byDate || []).map((row) => [row.date, row.revenue]),
    );
    channel.values = rows.map((week) => {
      if (!channel.source?.available || channel.source.seriesUnavailable)
        return null;
      let total = 0;
      for (
        let date = week.from;
        date <= week.to;
        date = new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10)
      ) {
        if (!daily.has(date)) return null;
        total += Number(daily.get(date)) || 0;
      }
      return total;
    });
  }
  return {
    range,
    channels,
    rows: rows.map((week, index) => ({
      ...week,
      total: channels.every((channel) => channel.values[index] !== null)
        ? channels.reduce((sum, channel) => sum + channel.values[index], 0)
        : null,
    })),
  };
}
function weeklyPanel(data, state) {
  const today =
    state.graphToday ||
    new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  const { range, channels, rows } = quarterChannelRows(data, today);
  const max = Math.max(...rows.map((row) => row.total || 0), 1);
  const formatDate = (date) => date.split("-").reverse().join(".");
  return card(
    "weeks",
    "Виторг за каналами",
    `Останні 13 завершених тижнів · ${formatDate(range.from)} — ${formatDate(range.to)}`,
    `<div class="bo-quarter-summary"><strong>${rows.every((row) => row.total !== null) ? money(rows.reduce((sum, row) => sum + row.total, 0)) : "—"}</strong><span>Т${rows[0].week}–Т${rows.at(-1).week} · сайт, Rozetka та Monomarket</span></div><div class="bo-stacked bo-quarter-stacked">${rows
      .map((row, index) => {
        const details = channels
          .map((channel) => `${channel.name}: ${money(channel.values[index])}`)
          .join(" · ");
        const tooltip = `${row.label} · ${formatDate(row.from)} — ${formatDate(row.to)} · Разом: ${money(row.total)} · ${details}`;
        return `<div class="bo-week"><div class="bo-stack" role="img" tabindex="0" aria-label="${esc(tooltip)}" data-quarter-tip="${esc(JSON.stringify({ week: row.label, from: row.from, to: row.to, total: row.total, channels: [...channels].reverse().map((channel) => ({ name: channel.name, color: channel.color, value: channel.values[index] })) }))}">${
          row.total === null
            ? '<div class="bo-week-missing">—</div>'
            : [...channels]
                .reverse()
                .map(
                  (channel) =>
                    `<div style="height:${(channel.values[index] / max) * 150}px;background:${channel.color}"></div>`,
                )
                .join("")
        }</div><small>${row.label}</small></div>`;
      })
      .join(
        "",
      )}</div><div class="bo-quarter-tooltip" id="quarter-channel-tooltip" role="tooltip" hidden></div><div class="bo-legend">${channels.map((channel) => `<span><i style="background:${channel.color}"></i>${channel.name}</span>`).join("")}</div><p class="bo-footnote">Сума трьох каналів. Окремий квартальний зріз; календар KPI на цей графік не впливає.</p>`,
  );
}
function categoryPanel(model, state, data) {
  const range=categoryPeriod(state.graphToday || state.to,state.categoryPeriod);
  if ('categorySales' in data) model={...model,sales:data.categorySales};
  state={...state,yoy:true,from:range.from};
  const prior =
    model.sales?.previous?.available && model.sales.previous.hasData
      ? model.sales.previous.categories
      : null;
  const tiles = categoryMosaic(model.sales?.categories, prior, state.yoy);
  const baselineYear = Number(state.from.slice(0, 4)) - 1;
  return card(
    "categories",
    "Категорії",
    `Площа — виторг, колір — зміна до ${baselineYear} · ${range.from} — ${range.to}`,
    tiles.length
      ? `<div class="bo-category-mosaic">${tiles
          .map((tile) => {
            const formattedDelta = !state.yoy
              ? "Порівняння вимкнено"
              : tile.delta == null
                ? "Немає бази"
                : (tile.delta > 0 ? "+" : "") + percent(tile.delta);
            const meta = {
              ...tile,
              formattedRevenue: money(tile.revenue),
              formattedDelta,
              baselineYear,
            };
            return `<button class="bo-mosaic-tile tone-${tile.tone} ${tile.w < 140 || tile.h < 90 ? "is-small" : ""}" data-bo-category="${esc(tile.label)}" data-category-meta="${esc(JSON.stringify(meta))}" style="left:${tile.x / 10}%;top:${tile.y / 5.2}%;width:calc(${tile.w / 10}% - 4px);height:calc(${tile.h / 5.2}% - 4px)"><strong>${esc(tile.label)}</strong><span>${money(tile.revenue)} · ${esc(formattedDelta)}</span></button>`;
          })
          .join(
            "",
          )}</div><div class="bo-category-legend"><span><i class="decline"></i>падіння</span><span><i class="flat"></i>без змін (±1%)</span><span><i class="growth"></i>зростання</span><span><i class="missing"></i>немає бази</span></div><div class="bo-quarter-tooltip bo-category-tooltip" id="category-mosaic-tooltip" role="tooltip" hidden></div><p class="bo-footnote">Насиченіший колір — зміна від 15%. ${!state.yoy ? "Увімкніть порівняння YoY, щоб побачити динаміку." : ""}</p>`
      : empty(model.sales == null ? "Завантажуємо категорії…" : model.sales.available === false ? "Дані категорій недоступні. Спробуйте ще раз." : "Немає продажів за категоріями."),
    `<div class="bo-segments" role="group" aria-label="Період категорій">${[ ['month','Поточний місяць'],['year','Поточний рік'] ].map(([key,label])=>`<button data-category-period="${key}" aria-pressed="${(state.categoryPeriod||'month')===key}">${label}</button>`).join('')}</div>`,
  );
}
export function trafficAreaMarkup(source) {
  if (!source?.available || !source.weeks?.length)
    return empty("Немає тижневих даних GA4 за джерелами.");
  const rows = source.weeks,
    groups = source.groups,
    width = 480,
    height = 225,
    left = 37,
    right = 470,
    top = 18,
    bottom = 190;
  const peak = Math.max(...rows.map((row) => row.total), 1),
    step = 10 ** Math.floor(Math.log10(peak)) / 10,
    max = Math.ceil(peak / (step * 2)) * step * 2,
    tick = max / 2;
  const x = (index) =>
      left + (index * (right - left)) / Math.max(1, rows.length - 1),
    y = (value) => bottom - (value / max) * (bottom - top);
  const running = rows.map(() => 0),
    areas = groups
      .map((group) => {
        const lower = running.map((value, index) => [x(index), y(value)]);
        rows.forEach(
          (row, index) => (running[index] += row.counts[group.id] || 0),
        );
        const upper = running.map((value, index) => [x(index), y(value)]);
        return `<path d="M${upper.map((point) => point.join(",")).join(" L")} L${[
          ...lower,
        ]
          .reverse()
          .map((point) => point.join(","))
          .join(
            " L",
          )}Z" fill="${group.color}" stroke="var(--surface)" stroke-width="1.5"/>`;
      })
      .join("");
  const grid = [0, tick, max]
    .map(
      (value) =>
        `<path d="M${left} ${y(value)}H${right}" stroke="var(--line)" stroke-dasharray="2 4"/><text x="${left - 12}" y="${y(value) + 3}" text-anchor="end">${number(value / 1000)}</text>`,
    )
    .join("");
  const ticks = rows
    .map((row, index) =>
      index % 2 === 0 || index === rows.length - 1
        ? `<text x="${x(index)}" y="${bottom + 20}" text-anchor="middle">${row.label}</text>`
        : "",
    )
    .join("");
  const hits = rows
    .map((row, index) => {
      const from = index === 0 ? left : (x(index - 1) + x(index)) / 2,
        to = index === rows.length - 1 ? right : (x(index) + x(index + 1)) / 2;
      const info = {
        week: row.label,
        from: row.from,
        to: row.to,
        total: row.total,
        unit: "sessions",
        channels: groups.map((group) => ({
          name: group.name,
          color: group.color,
          value: row.counts[group.id] || 0,
        })),
      };
      return `<g class="bo-traffic-hover"><rect class="bo-traffic-shade" x="${from}" y="${top}" width="${to - from}" height="${bottom - top}"/><rect class="bo-traffic-hit" tabindex="0" role="img" aria-label="${row.label}: ${number(row.total)} сеансів" data-quarter-tip="${esc(JSON.stringify(info))}" data-tip-target="#traffic-quarter-tooltip" x="${from}" y="${top}" width="${to - from}" height="${bottom - top}" fill="transparent"/></g>`;
    })
    .join("");
  return `<div class="bo-traffic-area"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Сеанси за джерелами по тижнях, тисячі">${grid}${areas}${ticks}${hits}</svg></div><div class="bo-traffic-legend">${groups.map((group) => `<span><i style="background:${group.color}"></i>${esc(group.name)}</span>`).join("")}</div><div class="bo-quarter-tooltip" id="traffic-quarter-tooltip" role="tooltip" hidden></div><p class="bo-footnote">${source.range.from.split("-").reverse().join(".")} — ${source.range.to.split("-").reverse().join(".")} · GA4${source.thresholded || source.incomplete ? " · Джерело повідомляє про обмеження даних." : ""}</p>`;
}
function trafficPanel(data) {
  return card(
    "traffic",
    "Джерела трафіку",
    "Сеанси, тис. · останні 13 завершених тижнів",
    trafficAreaMarkup(data.quarterTraffic),
  );
}
function marketPanel(data) {
  const source = data.priceIndex;
  if (!source?.available)
    return card(
      "market",
      "Ціна проти ринку",
      "SKU за ціновим індексом",
      empty("Завантажуємо повний ціновий зріз…"),
    );
  const max = Math.max(...source.buckets.map((bin) => bin.count), 1);
  return card(
    "market",
    "Ціна проти ринку",
    "SKU за ціновим індексом",
    `<div class="bo-price-index">${source.buckets.map((bin) => `<div class="bo-price-bin" role="img" tabindex="0" aria-label="${esc(bin.label)}%: ${number(bin.count)} SKU"><strong>${number(bin.count)}</strong><i style="height:${(bin.count / max) * 155}px;background:${bin.risk ? "var(--red)" : "var(--blue)"}" title="${esc(bin.label)}% · ${number(bin.count)} SKU"></i><span>${bin.label.replace("<", "&lt;").replace(">", "&gt;")}</span></div>`).join("")}</div><p class="bo-footnote">Індекс = наша ціна / медіана підтверджених цін конкурентів × 100. Нижче 100 — ми дешевші. ${number(source.total)} SKU зі співставленнями · поточний зріз ${esc(source.snapshotDate || "")}.</p>`,
  );
}
export function renderRevenueWaterfall(source, state) {
  const controls = `<div class="bo-segments" aria-label="Порівняння виторгу">${[
    ["yoy", "Рік до року"],
    ["month", "До попер. місяця"],
  ]
    .map(
      ([mode, label]) =>
        `<button data-waterfall-mode="${mode}" aria-pressed="${(state.waterfallMode || "yoy") === mode}">${label}</button>`,
    )
    .join("")}</div>`;
  const sub = "Особистий перегляд · розрахункові внески, млн ₴";
  if (!source?.available)
    return card(
      "waterfall",
      "Звідки приріст виручки",
      sub,
      empty(source?.notice || "Завантажуємо порівнювані дані ERP та GA4…"),
      controls,
      "bo-waterfall",
    );
  const periodLabel = (range) =>
    source.mode === "month"
      ? new Date(range.from + "T00:00:00Z").toLocaleDateString("uk-UA", {
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        })
      : range.from.slice(0, 4);
  const steps = [
    {
      label: periodLabel(source.comparisonRange),
      from: 0,
      to: source.start,
      value: source.start,
      total: true,
    },
    ...source.steps.map((step) =>
      step.key === "reconcile" ? { ...step, label: "Різниця в обліку" } : step,
    ),
    {
      label: periodLabel(source.range),
      from: 0,
      to: source.end,
      value: source.end,
      total: true,
    },
  ];
  const min = Math.min(0, ...steps.flatMap((step) => [step.from, step.to])),
    max = Math.max(1, ...steps.flatMap((step) => [step.from, step.to])) * 1.12;
  const left = 25,
    right = 735,
    bottom = 218,
    top = 25,
    slot = (right - left) / steps.length,
    width = Math.min(65, slot * 0.7),
    x = (index) => left + slot * index + (slot - width) / 2,
    y = (value) => bottom - ((value - min) / (max - min)) * (bottom - top);
  const bars = steps
    .map((step, index) => {
      const height = Math.max(2, Math.abs(y(step.to) - y(step.from))),
        barY = Math.min(y(step.to), y(step.from)),
        color = step.total
          ? "var(--text)"
          : step.key === "reconcile"
            ? "#aab3c2"
            : step.value >= 0
              ? "var(--blue)"
              : "var(--red)";
      const labels =
        step.key === "reconcile"
          ? ["Різниця", "в обліку"]
          : step.label === "Інші канали"
            ? ["Інші", "канали"]
            : [step.label];
      return `${index < steps.length - 1 ? `<path d="M${x(index) + width} ${y(step.to)}H${x(index + 1)}" stroke="var(--line)" stroke-width="1.5" stroke-dasharray="3 4"/>` : ""}<rect x="${x(index)}" y="${barY}" width="${width}" height="${height}" rx="7" fill="${color}"><title>${esc(step.label)}: ${step.value >= 0 && !step.total ? "+" : ""}${number(step.value)} ₴${step.key === "reconcile" ? " · GA4 рахує покупки, ERP — відвантаження. Це не втрачений виторг." : ""}</title></rect><text x="${x(index) + width / 2}" y="${barY - 9}" text-anchor="middle" class="bo-waterfall-number">${!step.total && step.value > 0 ? "+" : ""}${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(step.value / 1000000)}</text><text x="${x(index) + width / 2}" y="${bottom + 21}" text-anchor="middle">${labels.map((label, i) => `<tspan x="${x(index) + width / 2}" dy="${i ? 12 : 0}">${esc(label)}</tspan>`).join("")}</text>`;
    })
    .join("");
  const date = (range) =>
    range.from.split("-").reverse().join(".") +
    " — " +
    range.to.split("-").reverse().join(".");
  return card(
    "waterfall",
    "Звідки приріст виручки",
    sub,
    `<div class="bo-waterfall-plot"><svg viewBox="0 0 760 270" role="img" aria-label="Факторний аналіз зміни виторгу">${bars}</svg></div><details class="bo-accounting-note"><summary>Різниця в обліку · що це означає</summary><p><b>Різниця в обліку</b> — GA4 рахує покупки на сайті, ERP — фактичні відвантаження. Через різні дати, скасування та незареєстровані події підсумки можуть відрізнятися. Це <b>не показник втраченого виторгу</b>.</p></details><p class="bo-footnote">${date(source.comparisonRange)} → ${date(source.range)}. Фактори сайту: трафік → конверсія → чек; маркетплейси — окремо.</p>`,
    controls,
    "bo-waterfall",
  );
}
export function renderBusinessOverview(data, state, chartHTML) {
  const model = overviewModel(data, state),
    revenue = model.metrics[0];
  const sessions = model.metrics[3],
    cr = model.metrics[4];
  const changeText = !state.yoy
    ? `Відвантажений виторг за вибраний період — <b>${money(revenue.value)}</b>.`
    : revenue.delta == null
      ? "Порівнювана історія за цей період відсутня."
      : `Виторг ${revenue.delta >= 0 ? "зріс" : "знизився"} на <b>${percent(Math.abs(revenue.delta))}</b> до тих самих дат торік.`;
  const metric =
    model.metrics.find((metric) => metric.key === state.chartMetric) || revenue;
  const graphPeriod = { from: state.from, to: state.to };
  const miniOptions = {
    range: graphPeriod,
    interval: miniInterval(graphPeriod),
  };
  const chartOptions = {
    range: graphPeriod,
    interval: state.chartInterval === "week" ? "week" : "day",
  };
  const chartTotal = metric.value,
    chartPrior = metric.prior;
  const period = `${state.from.split("-").reverse().join(".")} — ${state.to.split("-").reverse().join(".")}`;
  return `<div class="business-overview"><section class="bo-brief"><div class="bo-ask"><span class="bo-eyebrow">✦ ЗНАЙДІТЬ ВІДПОВІДЬ У ДАНИХ</span><h2>З чого почнемо сьогодні?</h2><form id="bo-ask-form"><input id="bo-question" aria-label="Питання до огляду" placeholder="Наприклад: звідки приходять продажі?"><button aria-label="Знайти у звітах" type="submit">↗</button></form><div class="bo-prompts"><button data-bo-focus="channels">Який канал дає більше виторгу?</button><button data-bo-focus="categories">Які категорії продаються?</button><button data-bo-focus="market">Як наші ціни виглядають на ринку?</button></div><small>Швидкий перехід до показників цього огляду</small></div><div class="bo-insights"><span class="bo-eyebrow">ГОЛОВНЕ ЗА ВИБРАНИЙ ПЕРІОД</span><p class="bo-period-note">${period}</p><button data-bo-focus="revenue"><span class="bo-signal">↗</span><span>${changeText}<small>Відвантажені продажі · ERP</small></span><span class="bo-arrow">↗</span></button><button data-bo-focus="traffic"><span class="bo-signal">◎</span><span>${sessions.value == null ? "Дані користувачів наразі недоступні." : `<b>${short(sessions.value)}</b> унікальних користувачів з України. Конверсія у покупку — <b>${percent(cr.value)}</b>.`}<small>Користувачі — BigQuery · UA; конверсія — покупки / сеанси GA4</small></span><span class="bo-arrow">↗</span></button><button data-bo-focus="catalog"><span class="bo-signal">▦</span><span><b>${data.stock?.available ? number(data.stock.total) : "—"}</b> товарів у наявності. Content Score — <b>${data.content?.available ? number(data.content.score) : "—"} / 100</b>.<small>Поточний стан каталогу · API AGROMAT</small></span><span class="bo-arrow">↗</span></button></div></section><div class="bo-kpis" aria-label="Ключові показники">${model.metrics.map((m) => `<button class="bo-kpi ${state.chartMetric === m.key ? "selected" : ""}" data-bo-metric="${m.key}" aria-pressed="${state.chartMetric === m.key}"><div class="bo-kpi-label"><span>${m.label}</span>${state.yoy ? badge(m.delta, m.lower) : ""}</div><strong>${m.format(m.value)}</strong><small>${m.hint}</small>${weeklyChart(data.history, m.key, { mini: true, id: "mini-" + m.key, compare: state.yoy, ...miniOptions })}</button>`).join("")}</div><div class="bo-grid"><section class="bo-card bo-main-chart" id="bo-revenue" tabindex="-1"><div class="bo-chart-summary"><div><h2>${metric.label}</h2><p>${esc({ all: "Усі канали", site: "Сайт", rozetka: "Rozetka", monomarket: "Monomarket" }[state.chartChannel] || state.chartChannel)} · ${esc(state.chartSegment)}</p><strong>${metric.format(chartTotal)}</strong>${state.yoy ? badge(change(chartTotal, chartPrior), metric.lower) : ""}</div><div class="bo-segments" aria-label="Деталізація графіка">${[
    ["day", "Дні"],
    ["week", "Тижні"],
  ]
    .map(
      ([value, label]) =>
        `<button data-bo-interval="${value}" aria-pressed="${chartOptions.interval === value}">${label}</button>`,
    )
    .join(
      "",
    )}</div></div><div id="overview-sales-chart">${weeklyChart(data.history, metric.key, { id: "revenue-period", compare: state.yoy, ...chartOptions })}</div><p class="bo-footnote">Період: ${period}. Міні-графіки: до 40 днів — за днями, понад 40 — за тижнями.</p></section>${channelPanel(model, state)}${weeklyPanel(data, state)}${data.privateOverview ? renderRevenueWaterfall(data.waterfall, state) : ""}${renderSiteFunnel(data.siteFunnel,state.funnelMode)}${trafficPanel(data)}${marketPanel(data)}${categoryPanel(model, state, data)}<section class="bo-card bo-catalog" id="bo-catalog" tabindex="-1"><header><div><h2>Здоров’я каталогу</h2><p>Поточний стан · API AGROMAT</p></div><span class="bo-tag">LIVE</span></header><div class="bo-catalog-metrics"><div><strong>${data.stock?.available ? short(data.stock.total) : "—"}</strong><span>товарів у наявності</span></div><div><strong>${data.content?.available ? number(data.content.score) : "—"}<small>/100</small></strong><span>середній Content Score</span></div><div><strong>${data.products?.available ? short(data.products.stats?.noImages) : "—"}</strong><span title="Увесь каталог у поточному знімку, незалежно від наявності. API не містить жодного зображення (imagesCount = 0); биті посилання не перевіряються.">товарів без фото · весь каталог ⓘ</span></div></div></section><section class="bo-card bo-calls" id="bo-calls"><header><div><h2>Пропущені дзвінки</h2><p>Дані телефонії</p></div></header><div class="bo-empty"><div><strong>Не підключено</strong><p>Статистика дзвінків з’явиться після підключення телефонії.</p></div></div></section></div></div>`;
}

export function bindQuarterTooltips(root = document) {
  root.querySelectorAll("[data-quarter-tip]").forEach((column) => {
    const tooltip = root.querySelector(
      column.dataset.tipTarget || "#quarter-channel-tooltip",
    );
    if (!tooltip) return;
    const data = JSON.parse(column.dataset.quarterTip);
    const amount = (value) =>
      value == null
        ? "Немає даних"
        : new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(
            value >= 1000 ? value / 1000 : value,
          ) +
          (data.unit === "sessions"
            ? value >= 1000
              ? " тис."
              : ""
            : value >= 1000
              ? " тис ₴"
              : " ₴");
    const show = (event) => {
      root
        .querySelectorAll(".bo-week.is-hovered,.bo-traffic-hover.is-hovered")
        .forEach((week) => week.classList.remove("is-hovered"));
      column.parentElement.classList.add("is-hovered");
      column.setAttribute("aria-describedby", tooltip.id);
      tooltip.innerHTML = `<div class="bo-quarter-tip-title">${esc(data.week)}</div><small>${esc(data.from.split("-").reverse().join("."))} — ${esc(data.to.split("-").reverse().join("."))}</small>${data.channels.map((channel) => `<div class="bo-quarter-tip-row"><span><i style="background:${channel.color}"></i>${esc(channel.name)}</span><b>${amount(channel.value)}</b></div>`).join("")}<div class="bo-quarter-tip-row total"><span>Разом</span><b>${amount(data.total)}</b></div>`;
      tooltip.hidden = false;
      const rect = column.getBoundingClientRect(),
        x = event?.clientX ?? rect.right,
        y = event?.clientY ?? rect.bottom;
      tooltip.style.left =
        Math.max(
          8,
          Math.min(x + 16, window.innerWidth - tooltip.offsetWidth - 8),
        ) + "px";
      tooltip.style.top =
        Math.max(
          8,
          Math.min(y + 14, window.innerHeight - tooltip.offsetHeight - 8),
        ) + "px";
    };
    const hide = () => {
      tooltip.hidden = true;
      column.parentElement.classList.remove("is-hovered");
      column.removeAttribute("aria-describedby");
    };
    column.addEventListener("pointerenter", show);
    column.addEventListener("pointermove", show);
    column.addEventListener("pointerleave", hide);
    column.addEventListener("focus", () => show());
    column.addEventListener("blur", hide);
    column.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hide();
    });
  });
}
