import { graphRange, yearBefore } from './chart-periods.mjs';

const DAY = 86400000;
export const addDays = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
export const rangeDays = range => Math.round((Date.parse(range.to) - Date.parse(range.from)) / DAY) + 1;

export function overviewDefaults(today) {
  return { ...graphRange(today), compareMode: 'yoy', salesScope: 'all', acquisition: 'all', device: 'all' };
}

export function comparisonAvailability(range) {
  const days = rangeDays(range), [year, month] = range.from.split('-').map(Number);
  const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { wow: days > 0 && days <= 7, mom: days > 0 && days <= monthDays, yoy: days > 0 };
}

export function validComparison(range, mode = 'wow') {
  const allowed = comparisonAvailability(range);
  return allowed[mode] ? mode : allowed.mom ? 'mom' : 'yoy';
}

function previousMonth(date, end = false) {
  const [year, month, day] = date.split('-').map(Number);
  const last = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  const currentLast = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 2, end && day === currentLast ? last : Math.min(day, last))).toISOString().slice(0, 10);
}

export function comparisonRange(range, mode = 'wow') {
  if (!comparisonAvailability(range)[mode]) throw Error('comparison_unavailable');
  if (mode === 'wow') return { from: addDays(range.from, -7), to: addDays(range.to, -7) };
  if (mode === 'mom') return { from: previousMonth(range.from), to: previousMonth(range.to, true) };
  return { from: yearBefore(range.from), to: yearBefore(range.to) };
}

export const rangeLabel = range => `${range.from.split('-').reverse().join('.')} — ${range.to.split('-').reverse().join('.')}`;
export const scopeKey = state => JSON.stringify([state.from, state.to, state.compareMode, state.salesScope]);
export const hasWebSlice = state => state.acquisition !== 'all' || state.device !== 'all';
export const funnelAcquisitions = [['all','Усі'],['direct','Direct'],['organic','Organic'],['cpc','CPC']];
export const funnelDevices = [['all','Усі'],['mobile','Mobile'],['desktop','Desktop']];
export const funnelSliceKey = (acquisition = 'all', device = 'all') => `${acquisition}:${device}`;

const esc = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function filterGroup({key,label,values,selected,attribute,disabled=false}) {
  return `<fieldset class="bo-filter-group"${disabled?' disabled':''}><legend>${label}</legend><div class="bo-segments">${values.map(([value,name]) =>
    `<button type="button" ${attribute}="${key}" data-value="${value}" aria-pressed="${selected===value}">${name}</button>`
  ).join('')}</div></fieldset>`;
}

export function funnelControls(state) {
  const shared = {attribute:'data-funnel-filter',disabled:state.salesScope==='marketplaces'};
  return `<div class="bo-filter-groups bo-funnel-filters">${filterGroup({...shared,key:'acquisition',label:'Канали залучення',values:funnelAcquisitions,selected:state.acquisition ?? 'all'})}
    ${filterGroup({...shared,key:'device',label:'Пристрої',values:funnelDevices,selected:state.device ?? 'all'})}</div>`;
}

export function overviewControls(state) {
  const availability = comparisonAvailability(state);
  const mode = validComparison(state, state.compareMode);
  const comparisons = [
    ['wow', 'WoW', 'Інтервал до 7 днів'],
    ['mom', 'MoM', 'Інтервал не довший за місяць'],
    ['yoy', 'YoY', 'Ті самі дати минулого року'],
  ];
  return `<div class="bo-period-control"><div class="dated">
    <label class="sr" for="date-from">Від</label><input id="date-from" type="date" value="${esc(state.from)}">
    <label class="sr" for="date-to">До</label><input id="date-to" type="date" value="${esc(state.to)}">
    <button type="button" id="apply-dates">Застосувати</button>
  </div></div>
  <div class="bo-filter-groups">
    <fieldset class="bo-filter-group bo-comparison-control">
      <legend>Порівняння</legend>
      <div class="bo-segments" role="group" aria-label="Порівняння періодів">${comparisons.map(([key,label,reason]) =>
        `<button type="button" data-comparison="${key}" aria-pressed="${mode===key}" ${availability[key]?'':'disabled'} title="${reason}">${label}</button>`
      ).join('')}</div>
    </fieldset>
    ${filterGroup({key:'salesScope',label:'Канали продажу',values:[['all','Усі'],['site','Сайт'],['marketplaces','Маркетплейси']],selected:state.salesScope,attribute:'data-overview-filter'})}
  </div>`;
}

// Sales channels contain disjoint ERP documents. Never infer a missing channel as zero.
export function combineSales(sources) {
  if (!sources.length || sources.some(source => !source?.available)) return { available: false, notice: 'Немає повної розбивки продажів.' };
  const sum = (key) => sources.every(source => Number.isFinite(source.metrics?.[key])) ? sources.reduce((total, source) => total + source.metrics[key], 0) : null;
  const group = (key, fields) => {
    const rows = new Map();
    for (const source of sources) for (const row of source[key] || []) {
      const name = row.label ?? row.date, item = rows.get(name) || { [row.label == null ? 'date' : 'label']: name };
      for (const field of fields) item[field] = (item[field] || 0) + (Number(row[field]) || 0);
      if (row.missingQuantityLines) item.missingQuantityLines = (item.missingQuantityLines || 0) + row.missingQuantityLines;
      if (row.quantities) {
        const quantities = item.quantities ||= Object.create(null);
        for (const [unit, value] of Object.entries(row.quantities)) quantities[unit] = (quantities[unit] || 0) + value;
      }
      rows.set(name, item);
    }
    return [...rows.values()].sort((a, b) => key === 'byDate' ? a.date.localeCompare(b.date) : b.revenue - a.revenue);
  };
  return {
    available: true, hasData: sources.some(source => source.hasData),
    metrics: Object.fromEntries(['shippedRevenue', 'shippedDocs', 'shippedGoods', 'canceledDocs', 'receivedDocs', 'totalDocs'].map(key => [key, sum(key)])),
    byDate: group('byDate', ['revenue', 'docs', 'goods', 'canceled']),
    brands: group('brands', ['revenue', 'docs', 'goods']),
    categories: group('categories', ['revenue', 'docs', 'goods']),
    updatedAt: sources.map(source => source.updatedAt).filter(Boolean).sort()[0] || null,
  };
}

export function scopedSales(all, channels, scope = 'all') {
  if (scope === 'site') return channels.site || null;
  if (scope === 'marketplaces') {
    if (!channels.rozetka || !channels.monomarket) return null;
    const result = combineSales([channels.rozetka, channels.monomarket]);
    result.previous = combineSales([channels.rozetka.previous, channels.monomarket.previous]);
    return result;
  }
  return all || null;
}

export function selectedHistory(history, sales, range, baseline, margin) {
  if (!history && !sales) return null;
  const period = (source, dates, marginPeriod) => {
    if (!source?.available || source.seriesUnavailable) return {available:false,range:dates,days:[]};
    const byDate = new Map((source.byDate || []).map(row => [row.date,row]));
    const marginByDate = new Map((marginPeriod?.byDate || []).map(row => [row.date,row]));
    const days = [];
    for (let date=dates.from;date<=dates.to;date=addDays(date,1)) {
      const row=byDate.get(date);
      const marginDay = marginByDate.get(date);
      const marginAmount = marginDay ? marginDay.amount : marginPeriod?.coveredDocs ? 0 : null;
      days.push({date,revenue:row?.revenue||0,docs:row?.docs||0,canceled:row?.canceled??null,
        margin:marginAmount, marginCoveredRevenue:marginDay?.coveredRevenue ?? 0});
    }
    return {available:true,range:dates,coverageFrom:dates.from,coverageTo:dates.to,days};
  };
  return {...history,range:{...range,previousFrom:baseline.from,previousTo:baseline.to},sales:[period(sales,range,margin),period(sales?.previous,baseline,margin?.previous)]};
}
