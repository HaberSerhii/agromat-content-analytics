import { overviewRevenueWaterfall } from "./revenue-drivers.mjs";
import { comparisonRange, rangeLabel, selectedHistory, rangeDays } from './overview-filters.mjs?v=margin-tooltip';
import {renderSiteFunnel} from "./site-funnel.mjs?v=overview-copy";
import { categoryMosaic, categoryPeriod, categoryColor } from "./category-treemap.mjs?v=fastoverview2";
import {
  graphRange,
  yearBefore,
  miniInterval,
  lastQuarterWeeks,
  calendarBins,
} from "./chart-periods.mjs?v=fastoverview2";
import { weeklyChart, historySeries } from "./weekly-charts.mjs?v=margin-tooltip";
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
  const sales = 'comparisonRange' in data ? (available(data.chartSales) ? data.chartSales : null) : available(data.chartSales)
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
    const prior=data.comparisonRange || {from:yearBefore(state.from),to:yearBefore(state.to)};
    return current?{...current,previous:dailyTotals(prior.from,prior.to)}:null;
  })();
  const previousChannel =
    state.yoy && available(channel?.previous) && channel.complete !== false && channel.previous.complete !== false ? channel.previous : null;
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
    ...(data.margin ? [metric('margin', 'Прибуток', data.margin.amount,
      state.yoy ? data.margin.previous?.amount : null, money, 'Оцінка за маржею ERP відвантажених замовлень')] : []),
    metric(
      "docs",
      "Успішні замовлення",
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
      "Трафік · Україна",
      data.users?.available ? data.users.users : null,
      state.yoy &&
        data.users?.previous?.available &&
        data.users.complete !== false && data.users.previous.complete !== false &&
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
            channel.purchases ?? sum(channel.rows, "purchases"),
            channel.sessions ?? sum(channel.rows, "sessions"),
            100,
          )
        : null,
      previousChannel
        ? ratio(
            previousChannel.purchases ?? sum(previousChannel.rows, "purchases"),
            previousChannel.sessions ?? sum(previousChannel.rows, "sessions"),
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
    channels: channels.filter(channel => state.salesScope === 'site' ? channel.id === 'site' : state.salesScope === 'marketplaces' ? channel.id !== 'site' : true),
    total: m.shippedRevenue ?? null,
  };
}
function badge(delta, lower = false) {
  if (delta == null) return '<span class="bo-delta neutral">Немає бази</span>';
  return `<span class="bo-delta ${(lower ? delta <= 0 : delta >= 0) ? "positive" : "negative"}">${delta >= 0 ? "↗" : "↘"} ${percent(Math.abs(delta))}</span>`;
}
function card(id, title, sub, body, extra = "", cls = "") {
  return `<section class="bo-card ${cls}" id="bo-${id}" tabindex="-1"><header><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ""}</div>${extra}</header>${body}</section>`;
}
function empty(text) {
  return `<div class="bo-empty"><span>↗</span><p>${text}</p></div>`;
}
function channelPanel(model, state) {
  const valid = model.channels.filter((c) => c.value != null),
    known = sum(valid, "value");
  const total = model.total;
  const residual = total != null ? total - known : 0;
  const expected = state.salesScope === 'site' ? 1 : state.salesScope === 'marketplaces' ? 2 : 3;
  const complete = valid.length === expected && total > 0 && residual >= -0.01;
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
  if (state.salesScope !== 'site') rows.splice(2, 0, {id:"prom",name:"Prom",value:null,prior:null,color:colors[3]});
  let offset = 0;
  const circumference = 2 * Math.PI * 60;
  const segments = complete ? rows.filter(channel => channel.value > 0).map(channel => {
    const length = channel.value / total * circumference;
    const svg = `<circle cx="80" cy="80" r="60" fill="none" stroke="${channel.color}" stroke-width="20" stroke-dasharray="${Math.max(0,length-2)} ${circumference}" stroke-dashoffset="${-offset-1}" transform="rotate(-90 80 80)"><title>${esc(channel.name)}: ${esc(money(channel.value))} · ${esc(percent(channel.value/total*100))}</title></circle>`;
    offset += length;
    return svg;
  }).join('') : '';
  const count = rows.filter(channel => channel.value > 0).length;
  return card(
    "channels",
    "Канали продажу",
    "",
    `<div class="bo-channel-layout"><svg class="bo-channel-donut" viewBox="0 0 160 160" role="img" aria-label="Частки виторгу за каналами продажу"><circle cx="80" cy="80" r="60" fill="none" stroke="var(--line)" stroke-width="20"/>${segments}<text x="80" y="78" text-anchor="middle" class="bo-donut-total">${esc(money(total))}</text><text x="80" y="98" text-anchor="middle" class="bo-donut-label">${complete ? `${count} ${count===1?'канал':count<5?'канали':'каналів'}` : 'неповна розбивка'}</text></svg><div class="bo-channel-list">${rows.map(c => `<div class="bo-channel-row" title="${esc(c.name)}: ${esc(c.value == null ? 'Джерело не підключено' : money(c.value))}"><span class="bo-dot" style="background:${c.color}"></span><span>${esc(c.name)}</span><b>${complete && c.value != null ? number(c.value / total * 100)+'%' : '—'}</b>${state.yoy ? badge(change(c.value,c.prior)) : ''}</div>`).join('')}</div></div>`,
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
export function periodChannelRows(data,state) {
  const range={from:state.from,to:state.to},rows=calendarBins(range,rangeDays(range)>90?'month':rangeDays(range)>21?'week':'day');
  const ids=state.salesScope==='site'?['site']:state.salesScope==='marketplaces'?['rozetka','monomarket']:['site','rozetka','monomarket'];
  const names={site:'Сайт',rozetka:'Rozetka',monomarket:'Monomarket'};
  const channels=ids.map(id=>({id,name:names[id],color:colors[['site','rozetka','monomarket'].indexOf(id)],values:rows.map(bin=>{
    const source=data.salesChannels?.[id];
    return source?.available&&!source.seriesUnavailable?sum(source.byDate?.filter(row=>row.date>=bin.from&&row.date<=bin.to),'revenue'):null;
  })}));
  return {range,channels,rows:rows.map((row,index)=>({...row,total:channels.every(channel=>channel.values[index]!=null)?channels.reduce((total,channel)=>total+channel.values[index],0):null}))};
}
function weeklyPanel(data, state) {
  const today =
    state.graphToday ||
    new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  const { range, channels, rows } = data.comparisonRange ? periodChannelRows(data,state) : quarterChannelRows(data, today);
  const max = Math.max(...rows.map((row) => row.total || 0), 1);
  const formatDate = (date) => date.split("-").reverse().join(".");
  return card(
    "weeks",
    "Виторг за каналами",
    "",
    `<div class="bo-quarter-summary"><strong>${rows.every((row) => row.total !== null) ? money(rows.reduce((sum, row) => sum + row.total, 0)) : "—"}</strong></div><div class="bo-stacked bo-quarter-stacked">${rows
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
      )}</div><div class="bo-quarter-tooltip" id="quarter-channel-tooltip" role="tooltip" hidden></div><div class="bo-legend">${channels.map((channel) => `<span><i style="background:${channel.color}"></i>${channel.name}</span>`).join("")}</div>`,
  );
}
function categoryPanel(model, state, data, dimension = 'categories') {
  const brand = dimension === 'brands', range = {from:state.from,to:state.to};
  const measure = state[brand ? 'brandMeasure' : 'categoryMeasure'] === 'goods' ? 'goods' : 'revenue';
  const measureLabel = measure === 'goods' ? 'Кількість' : 'Виторг';
  const format = measure === 'goods' ? value => `${number(value)} шт.` : money;
  const controls = `<div class="bo-segments bo-map-units" role="group" aria-label="${brand ? 'Одиниці карти брендів' : 'Одиниці карти категорій'}">${[['revenue','грн'],['goods','шт.']].map(([key,label]) =>
    `<button type="button" data-map="${dimension}" data-measure="${key}" aria-pressed="${measure === key}">${label}</button>`
  ).join('')}</div>`;
  const prior = model.sales?.previous?.available && model.sales.previous.hasData ? model.sales.previous[dimension] : null;
  const tiles = categoryMosaic(model.sales?.[dimension], prior, state.yoy, {measure,limit:24,otherLabel:brand?'Інші бренди':'Інші категорії',height:680});
  const shownLabels = tiles.filter(tile => !tile.items).map(tile => tile.label);
  const baselineLabel = rangeLabel(data.comparisonRange || comparisonRange(range, state.compareMode || 'yoy'));
  return card(
    dimension,
    brand ? 'Бренди' : 'Категорії',
    "",
    tiles.length
      ? `<div class="bo-category-mosaic">${tiles
          .map((tile) => {
            const formattedDelta = !state.yoy
              ? "Порівняння вимкнено"
              : tile.delta == null
                ? "Немає бази"
                : (tile.delta > 0 ? "+" : "") + percent(tile.delta);
            const meta = {
              label: tile.label,
              dimension,
              measure,
              shownLabels: tile.items ? shownLabels : undefined,
              measureLabel,
              formattedValue: format(tile[measure]),
              formattedDelta,
              baselineLabel,
              period: `${range.from} — ${range.to}`,
            };
            return `<button type="button" class="bo-mosaic-tile tone-${tile.tone} ${tile.w < 140 || tile.h < 90 ? "is-small" : ""}" title="${esc(tile.label)}" data-category-meta="${esc(JSON.stringify(meta))}" aria-haspopup="dialog" aria-label="${esc(tile.label)}: ${esc(format(tile[measure]))}; ${esc(formattedDelta)}" style="${tile.color ? `background:${tile.color.background};color:${tile.color.foreground};` : ""}left:${tile.x / 10}%;top:${tile.y / 6.8}%;width:calc(${tile.w / 10}% - 3px);height:calc(${tile.h / 6.8}% - 3px)"><strong>${esc(tile.label)}</strong><span>${format(tile[measure])} · ${esc(formattedDelta)}</span></button>`;
          })
          .join(
            "",
          )}</div><div class="bo-category-legend"><span><i class="decline"></i>падіння</span><div class="bo-heatmap-scale" role="img" aria-label="Тепла шкала падіння, холодна шкала зростання; крок 2%">${Array.from({length:41},(_,index)=>(index-20)*2).map(delta=>`<i style="background:${categoryColor(delta).background}" title="${delta>0?'+':''}${delta}%"></i>`).join("")}</div><span><i class="growth"></i>зростання</span><span><i class="missing"></i>немає бази</span></div><div class="bo-quarter-tooltip bo-category-tooltip" id="${dimension}-mosaic-tooltip" role="tooltip" hidden></div>`
      : empty(data.scopeNotice || (model.sales == null ? `Завантажуємо ${brand?'бренди':'категорії'}…` : data.scopeNotice || `Немає продажів за ${brand?'брендами':'категоріями'}.`)),
    controls,
  );
}

export function renderSalesBreakdown(source, {label, dimension, measure, shownLabels}) {
  if (!source) return '<p>Деталізація продажів тимчасово недоступна.</p>';
  const key = dimension === 'brands' ? 'brand' : 'category';
  const omitted = shownLabels && new Set(shownLabels);
  const detailsKey = omitted ? key : key === 'brand' ? 'category' : 'brand';
  const rows = new Map();
  for (const pair of source.pairs) {
    if (omitted ? omitted.has(pair[key]) : pair[key] !== label) continue;
    const name = pair[detailsKey];
    const row = rows.get(name) || {name, current:0, previous:0};
    row.current += pair.current?.[measure] ?? 0;
    row.previous += pair.previous?.[measure] ?? 0;
    rows.set(name, row);
  }
  if (!rows.size) return '<p>У цьому зрізі немає відвантажених продажів.</p>';
  const sorted = [...rows.values()].sort((a, b) => b.current - a.current || b.previous - a.previous || a.name.localeCompare(b.name, 'uk'));
  const format = new Intl.NumberFormat('uk-UA', {maximumFractionDigits:measure === 'goods' ? 0 : 2});
  const dates = range => `<small>${rangeLabel(range).replace(' — ', ' — <wbr>')}</small>`;
  return `<p class="bo-breakdown-source">Відвантажені продажі · ERP · ${measure === 'goods' ? 'шт.' : 'грн'}</p>
    <div class="bo-breakdown-table"><table aria-label="Відвантажені продажі за два періоди">
      <thead><tr><th scope="col">${detailsKey === 'brand' ? 'Бренд' : 'Категорія'}</th><th scope="col" class="num">Вибраний період${dates(source.range)}</th><th scope="col" class="num">Торік${dates(source.lastYear)}</th></tr></thead>
      <tbody>${sorted.map(row => `<tr><th scope="row">${esc(row.name)}</th><td class="num">${format.format(row.current)}</td><td class="num">${source.previousAvailable ? format.format(row.previous) : '—'}</td></tr>`).join('')}</tbody>
    </table></div>${source.previousAvailable ? '' : '<p>Дані за торішній період тимчасово недоступні.</p>'}`;
}

export function trafficAreaMarkup(source) {
  if (!source?.available || !source.weeks?.length)
    return empty("Немає даних GA4 за цим зрізом.");
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
  return `<div class="bo-traffic-area"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Сеанси за джерелами у вибраному періоді, тисячі">${grid}${areas}${ticks}${hits}</svg></div><div class="bo-traffic-legend">${groups.map((group) => `<span><i style="background:${group.color}"></i>${esc(group.name)}</span>`).join("")}</div><div class="bo-quarter-tooltip" id="traffic-quarter-tooltip" role="tooltip" hidden></div>`;
}
function trafficPanel(data) {
  return card(
    "traffic",
    "Джерела трафіку",
    "Сеанси, тис.",
    trafficAreaMarkup(data.quarterTraffic),
  );
}
function marketPanel(data) {
  const source = data.priceIndex;
  if (!source?.available)
    return card(
      "market",
      "Ціна проти ринку",
      "",
      empty("Завантажуємо повний ціновий зріз…"),
    );
  const max = Math.max(...source.buckets.map((bin) => bin.count), 1);
  return card(
    "market",
    "Ціна проти ринку",
    "",
    `<div class="bo-price-index">${source.buckets.map((bin) => `<div class="bo-price-bin" role="img" tabindex="0" aria-label="${esc(bin.label)}%: ${number(bin.count)} SKU"><strong>${number(bin.count)}</strong><i style="height:${(bin.count / max) * 155}px;background:${bin.risk ? "var(--red)" : "var(--blue)"}" title="${esc(bin.label)}% · ${number(bin.count)} SKU"></i><span>${bin.label.replace("<", "&lt;").replace(">", "&gt;")}</span></div>`).join("")}</div>`,
  );
}
export function renderRevenueWaterfall(source, state) {
  const mode = state.compareMode || 'yoy';
  const magnitude=Math.max(Math.abs(source?.start||0),Math.abs(source?.end||0));
  const scale=magnitude>=1000000?1000000:magnitude>=1000?1000:1;
  const sub = `${{wow:'WoW',mom:'MoM',yoy:'YoY'}[mode] || mode} · ${scale===1000000?'млн ':scale===1000?'тис. ':''}₴`;
  if (!source?.available) return card('waterfall','Звідки приріст виручки',sub,empty(source?.notice || 'Завантажуємо порівнювані відвантаження…'),'','bo-waterfall');
  const label = period => mode === 'yoy' ? period.from.slice(0,4) : `${period.from.slice(8)}.${period.from.slice(5,7)}–${period.to.slice(8)}.${period.to.slice(5,7)}`;
  const steps = [{label:label(source.comparisonRange),from:0,to:source.start,value:source.start,total:true},...source.steps,{label:label(source.range),from:0,to:source.end,value:source.end,total:true}];
  const min = Math.min(0,...steps.flatMap(step=>[step.from,step.to]));
  const max = Math.max(1,...steps.flatMap(step=>[step.from,step.to]));
  const top=34,bottom=207,left=16,right=464;
  const y=value=>bottom-(value-min)/(max-min)*(bottom-top);
  const slot=(right-left)/steps.length, width=Math.min(52,slot*.65), x=index=>left+index*slot+(slot-width)/2;
  const amount=value=>{const scaled=Math.abs(value)/scale,formatted=scaled>0&&scaled<.005?'<0,01':new Intl.NumberFormat('uk-UA',{maximumFractionDigits:2}).format(scaled);return `${value<0?'−':''}${formatted}`;};
  const bars=steps.map((step,index)=>{
    const barY=Math.min(y(step.from),y(step.to)),height=Math.max(2,Math.abs(y(step.to)-y(step.from)));
    const color=step.total?'var(--text)':step.value>=0?'var(--blue)':'var(--red)';
    const labels=step.label==='Інші канали'?['Інші','канали']:[step.label];
    return `${index<steps.length-1?`<path d="M${x(index)+width} ${y(step.to)}H${x(index+1)}" stroke="var(--line)" stroke-width="1.5" stroke-dasharray="3 4"/>`:''}<rect x="${x(index)}" y="${barY}" width="${width}" height="${height}" rx="7" fill="${color}"><title>${esc(step.label)}: ${step.value>0&&!step.total?'+':''}${number(step.value)} ₴</title></rect><text x="${x(index)+width/2}" y="${barY-9}" text-anchor="middle" class="bo-waterfall-number">${step.value>0&&!step.total?'+':''}${esc(amount(step.value))}</text><text x="${x(index)+width/2}" y="${bottom+20}" text-anchor="middle">${labels.map((label,i)=>`<tspan x="${x(index)+width/2}" dy="${i?12:0}">${esc(label)}</tspan>`).join('')}</text>`;
  }).join('');
  return card('waterfall','Звідки приріст виручки',sub,`<div class="bo-waterfall-plot"><svg viewBox="0 0 480 250" role="img" aria-label="Внесок замовлень, чека й каналів у зміну відвантаженого виторгу">${bars}</svg></div>`,'','bo-waterfall');
}

const catalogDecimal = new Intl.NumberFormat('uk-UA', {maximumFractionDigits:2});
const catalogScore = value => Number.isFinite(value) ? catalogDecimal.format(value) : '—';
const catalogDay = date => date ? date.split('-').reverse().join('.') : '—';
const catalogTone = value => value > 0 ? 'up' : value < 0 ? 'down' : '';
function catalogSigned(value, precision = 2) {
  const rounded = Number(value.toFixed(precision));
  return (rounded > 0 ? '+' : rounded < 0 ? '−' : '') + catalogDecimal.format(Math.abs(rounded));
}

export function renderCatalogScoreHistory(segment, monthStart) {
  const changeCell = value => `<td class="${catalogTone(value)}">${Number.isFinite(value) ? catalogSigned(value) : '—'}</td>`;
  const base = segment.scoreBaseDate
    ? `База місяця — <strong>${catalogScore(segment.scoreBase)}</strong> від ${esc(catalogDay(segment.scoreBaseDate))}.`
    : 'База місяця з’явиться після першого знімка CS.';
  const rows = [...segment.scoreHistory].reverse().map(({date, score, daily, monthChange}) => `<tr>
    <th scope="row">${esc(catalogDay(date))}</th><td>${Number.isFinite(score) ? catalogScore(score) : 'Немає даних'}</td>
    ${changeCell(daily)}${changeCell(monthChange)}</tr>`).join('');
  return `<p class="bo-score-history-note">${base} Зміна за день порівнюється з попередньою календарною датою.</p>
    <table class="bo-catalog-table bo-score-history"><caption class="sr">Щоденний CS за ${esc(monthStart?.slice(0, 7))}</caption>
    <thead><tr><th scope="col">Дата</th><th scope="col">CS</th><th scope="col">За день</th><th scope="col">За місяць</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function catalogPanel(data) {
  const source = data.catalogHealth;
  const labels = ['Плитка', 'Сантехніка', 'Підлогові покриття', 'Будівельна хімія'];
  const delta = (value, meta, unit = '', precision = 2, historyLabel = '') => {
    const display = Number.isFinite(value) ? catalogSigned(value, precision) + unit : '—';
    const tooltip = {...meta, comparisons:[{label:'Зміна', relative:display === '—' ? meta.missing || 'Немає бази для порівняння' : display}]};
    const history = historyLabel ? ` data-catalog-score-history="${esc(historyLabel)}" aria-haspopup="dialog"` : '';
    const name = meta.title + ' · Зміна ' + display + (historyLabel ? ' · Щоденна історія' : '');
    return `<button type="button" class="bo-catalog-delta ${catalogTone(value)}" data-catalog-tip="${esc(JSON.stringify(tooltip))}"${history} aria-label="${esc(name)}">${display}</button>`;
  };
  const previousLabel = {wow:'Попередній тиждень', mom:'Попередній місяць', yoy:'Ті самі дати торік'}[source?.compareMode] || 'Попередній період';
  const body = `<table class="bo-catalog-table"><thead><tr>
    <th scope="col"><span class="sr">Сегмент</span></th><th scope="col" title="Кількість товарів із залишком від 1">У наявності</th>
    <th scope="col" title="Покази товарів">Impressions</th><th scope="col" title="Перегляди карток / покази товарів">CTR</th>
    <th scope="col" title="Середній Content Score">CS</th>
  </tr></thead><tbody>${labels.map(label => {
    const segment = source?.segments?.find(item => item.label === label);
    if (!segment) return `<tr><th scope="row">${label}</th><td>—</td><td>—</td><td>—</td><td>—</td></tr>`;
    const movement = segment.stockMovement;
    const daily = (date, value, precision) => Number.isFinite(value)
      ? `До ${catalogDay(date)}: ${catalogSigned(value, precision)}.` : '';
    const stockNote = movement ? `+${number(movement.gained)} товарів з’явилися, −${number(movement.lost)} вибули.`
      : 'Немає знімка на початок місяця.';
    const snapshot = (metric, from, to, before, now, note, baseLabel = 'Було на початок місяця') => ({
      title:`${label} · ${metric}`, note,
      rows:[
        {label:baseLabel, dates:catalogDay(from), value:before},
        {label:'Станом на', dates:catalogDay(to), value:now},
      ],
    });
    const traffic = (metric, before, now, note) => ({
      title:`${label} · ${metric}`, note,
      rows:[
        {label:previousLabel, dates:source.comparisonRange && rangeLabel(source.comparisonRange), value:before},
        {label:'Вибраний період', dates:source.trafficRange && rangeLabel(source.trafficRange), value:now},
      ],
    });
    const scoreTip = snapshot('Content Score', segment.scoreHistory ? segment.scoreBaseDate : source.scoreStart,
      segment.scoreHistory ? segment.scoreDate : source.scoreDate,
      catalogScore(segment.scoreBase), catalogScore(segment.score), [daily(segment.scorePriorDay ?? source.scorePriorDay, segment.scoreDaily, 2),
        segment.scoreHistory && 'Натисніть, щоб відкрити щоденну історію.'].filter(Boolean).join(' '), 'База місяця');
    if (Number.isFinite(segment.scoreBase) && !Number.isFinite(segment.score)) scoreTip.missing = 'Немає даних за поточний місяць';
    return `<tr><th scope="row">${label}</th>
      <td>${number(segment.stockBase ?? segment.inStock)}${delta(movement?.net, snapshot('У наявності', source.stockStart, source.stockDate,
        number(segment.stockBase), number(segment.inStock), [stockNote, daily(source.stockPriorDay, segment.stockDaily, 0)].filter(Boolean).join(' ')), '', 0)}</td>
      <td>${number(segment.impressions)}${delta(segment.impressionsChange,
        traffic('Покази товарів', number(segment.priorImpressions), number(segment.impressions)), '%')}</td>
      <td>${percent(segment.ctr)}${delta(segment.ctrChange,
        traffic('CTR', percent(segment.priorCtr), percent(segment.ctr), 'CTR — частка переглядів карток товарів від усіх показів.'), ' в.п.')}</td>
      <td>${catalogScore(segment.scoreBase ?? segment.score)}${delta(segment.scoreChange, scoreTip, '', 2, segment.scoreHistory ? label : '')}</td></tr>`;
  }).join('')}</tbody></table>
  <div class="bo-quarter-tooltip bo-funnel-tooltip" id="catalog-hover-tooltip" role="tooltip" hidden></div>
  ${!source ? '<p class="bo-catalog-period" role="status">Завантажуємо показники…</p>' : !source.available ? '<p class="bo-catalog-period">Дані сегментів тимчасово недоступні.</p>' : ''}`;
  return card('catalog','Здоров’я каталогу','',body,'','bo-catalog');
}
function readyToShipMarkup(snapshot) {
  if (!Number.isFinite(snapshot?.revenue)) return '';
  const time = new Date(snapshot.updatedAt);
  const formatted = Number.isFinite(time.getTime()) ? new Intl.DateTimeFormat('uk-UA', {
    timeZone:'Europe/Kyiv', dateStyle:'short', timeStyle:'short',
  }).format(time) : '';
  const tooltip = ['Усі канали · ERP', formatted && 'Станом на ' + formatted,
    number(snapshot.docs) + ' замовлень'].filter(Boolean).join(' · ');
  const sign = snapshot.revenue > 0 ? '+' : '';
  return `<span class="bo-kpi-subvalue bo-ready-to-ship" title="${esc(tooltip)}"><span>Транзит</span><b>${sign}${money(snapshot.revenue)}</b></span>`;
}
export function renderBusinessOverview(data, state, chartHTML) {
  const model = overviewModel(data, state),
    revenue = model.metrics[0];
  const metric =
    model.metrics.find((metric) => metric.key === state.chartMetric) || revenue;
  const graphPeriod = { from: state.from, to: state.to };
  const history = data.scopeNotice ? {range:graphPeriod} : data.comparisonRange ? selectedHistory(data.history,model.sales,graphPeriod,data.comparisonRange,data.margin) : data.history;
  const miniOptions = {
    range: graphPeriod,
    interval: miniInterval(graphPeriod),
    comparisonMode: state.compareMode,
  };
  const chartOptions = {
    range: graphPeriod,
    interval: state.chartInterval === "week" ? "week" : "day",
    comparisonMode: state.compareMode,
  };
  const chartTotal = metric.value,
    chartPrior = metric.prior;
  const subvalue = key => {
    if (key === 'revenue') return readyToShipMarkup(data.readyToShip);
    if (key !== 'margin') return '';
    const {coveredDocs, docs, percent: marginPercent} = data.margin;
    const hint = Number.isFinite(coveredDocs)
      ? `Оцінка ERP · ${number(coveredDocs)} з ${number(docs)} відвантажених замовлень мають маржу` : '';
    return `<span class="bo-kpi-subvalue" title="${esc(hint)}"><span>Прибуток, %</span><b>${percent(marginPercent)}</b></span>`;
  };
  return `<div class="business-overview ${data.updating?'is-updating':''}" aria-busy="${!!data.updating}">${data.updating?'<p class="bo-cache-notice" role="status">Оновлюємо вибраний зріз…</p>':''}${data.cachedAt?`<p class="bo-cache-notice" role="status">Збережені дані · ${new Date(data.cachedAt).toLocaleString('uk-UA',{timeZone:'Europe/Kyiv',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})} · оновлюємо у фоні</p>`:''}<div class="bo-kpis" aria-label="Ключові показники">${model.metrics.map((m) => `<button class="bo-kpi ${metric.key === m.key ? "selected" : ""}" data-bo-metric="${m.key}" aria-pressed="${metric.key === m.key}"><div class="bo-kpi-label"><span>${m.label}</span>${state.yoy ? badge(m.delta, m.lower) : ""}</div><strong>${m.format(m.value)}</strong>${subvalue(m.key)}${weeklyChart(history, m.key, { mini: true, id: "mini-" + m.key, compare: state.yoy, showCaption: false, ...miniOptions })}</button>`).join("")}</div><div class="bo-grid"><section class="bo-card bo-main-chart" id="bo-revenue" tabindex="-1"><div class="bo-chart-summary"><div><h2>${metric.label}</h2><p>${esc({all:"Усі канали",site:"Сайт",marketplaces:"Маркетплейси"}[state.salesScope || state.chartChannel] || state.chartChannel)}${state.acquisition&&state.acquisition!=="all"?" · "+esc(state.acquisition):""}${state.device&&state.device!=="all"?" · "+esc(state.device):""}</p><strong>${metric.format(chartTotal)}</strong>${state.yoy ? badge(change(chartTotal, chartPrior), metric.lower) : ""}</div><div class="bo-segments" aria-label="Деталізація графіка">${[
    ["day", "Дні"],
    ["week", "Тижні"],
  ]
    .map(
      ([value, label]) =>
        `<button data-bo-interval="${value}" aria-pressed="${chartOptions.interval === value}">${label}</button>`,
    )
    .join(
      "",
    )}</div></div><div id="overview-sales-chart">${weeklyChart(history, metric.key, { id: "revenue-period", compare: state.yoy, ...chartOptions })}</div></section>${channelPanel(model, state)}<div class="bo-overview-summary">${weeklyPanel(data, state)}${catalogPanel(data)}${renderRevenueWaterfall(overviewRevenueWaterfall(data, state, state.compareMode || "yoy"), state)}</div><div class="bo-overview-trio">${renderSiteFunnel(data.siteFunnel,state.compareMode,{selection:true,notice:data.scopeNotice})}${trafficPanel(data)}${marketPanel(data)}</div><div class="bo-overview-mosaics">${categoryPanel(model, state, data)}${categoryPanel(model, state, data, "brands")}</div></div></div>`;
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
