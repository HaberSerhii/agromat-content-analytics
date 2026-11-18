import { comparisonRange, scopedSales } from './overview-filters.mjs';

export const waterfallComparison = (range, mode = 'yoy') => comparisonRange(range, mode === 'month' ? 'mom' : mode);
const metric = (source, key) => source?.available && Number.isFinite(source.metrics?.[key]) ? source.metrics[key] : null;

// One ERP identity: revenue = shipped orders × shipped AOV. No GA4/ERP residual.
export function revenueWaterfall(current, previous, range, baseline, mode = 'yoy') {
  const start = metric(previous.all,'shippedRevenue'), end = metric(current.all,'shippedRevenue');
  const s0 = metric(previous.site,'shippedRevenue'), s1 = metric(current.site,'shippedRevenue');
  const d0 = metric(previous.site,'shippedDocs'), d1 = metric(current.site,'shippedDocs');
  const r0 = metric(previous.rozetka,'shippedRevenue'), r1 = metric(current.rozetka,'shippedRevenue');
  const m0 = metric(previous.monomarket,'shippedRevenue'), m1 = metric(current.monomarket,'shippedRevenue');
  if ([start,end,s0,s1,d0,d1,r0,r1,m0,m1].some(value => value === null || value < 0)) return {available:false,range,comparisonRange:baseline,mode,notice:'Немає повної порівнюваної бази відвантажень.'};
  const factors = d0 > 0 && d1 > 0 ? [
    {key:'orders',label:'Замовлення',value:d1 * s0 / d0 - s0},
    {key:'aov',label:'Чек',value:s1 - d1 * s0 / d0},
  ] : [{key:'site',label:'Сайт',value:s1-s0}];
  factors.push(
    {key:'marketplaces',label:'Маркетплейси',value:r1+m1-r0-m0},
    {key:'other',label:'Інші канали',value:end-s1-r1-m1-(start-s0-r0-m0)},
  );
  let running = start;
  const steps = factors.filter(factor => Math.abs(factor.value) > .005).map(factor => {
    const from = running; running += factor.value;
    return {...factor,from,to:running};
  });
  return {available:true,range,comparisonRange:baseline,mode,start,end,steps,residual:end-running,source:'ERP',updatedAt:new Date().toISOString()};
}

export function overviewRevenueWaterfall(data, range, mode = 'yoy') {
  const ids = ['site','rozetka','monomarket'];
  if (!data.sales || !ids.every(id => data.salesChannels?.[id])) return null;
  const baseline = data.comparisonRange || waterfallComparison(range,mode);
  const legacy = mode === 'month' && !data.comparisonRange;
  if (legacy && (data.waterfallBaseline?.range?.from !== baseline.from || data.waterfallBaseline?.range?.to !== baseline.to)) return null;
  const old = Object.fromEntries(ids.map(id=>[id,legacy?data.waterfallBaseline[id]:data.salesChannels[id].previous]));
  const scope = range.salesScope || 'all';
  const zero = {available:true,metrics:{shippedRevenue:0,shippedDocs:0}};
  const current = {all:scopedSales(data.sales,data.salesChannels,scope)};
  const previous = {all:scopedSales(legacy?data.waterfallBaseline.all:data.sales.previous,old,scope)};
  for (const id of ids) {
    const excluded = scope === 'site' ? id !== 'site' : scope === 'marketplaces' ? id === 'site' : false;
    current[id] = excluded ? zero : data.salesChannels[id];
    previous[id] = excluded ? zero : old[id];
  }
  return revenueWaterfall(current,previous,range,baseline,mode);
}
