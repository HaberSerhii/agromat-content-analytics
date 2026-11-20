import { comparisonRange, scopedSales } from './overview-filters.mjs';

export const waterfallComparison = (range, mode = 'yoy') => comparisonRange(range, mode === 'month' ? 'mom' : mode);
const metric = (source, key) => source?.available && Number.isFinite(source.metrics?.[key]) ? source.metrics[key] : null;

function sessions(source, period) {
  if (!source?.available || source.complete === false || source.incomplete || source.thresholded) return null;
  if (source.range && (source.range.from !== period.from || source.range.to !== period.to)) return null;
  if (source.sessions !== undefined) return Number.isFinite(source.sessions) && source.sessions > 0 ? source.sessions : null;
  if (!source.rows?.length || source.rows.some(row => !Number.isFinite(row.sessions) || row.sessions < 0)) return null;
  return source.rows.reduce((sum, row) => sum + row.sessions, 0) || null;
}

export function orderLossImpact(current, previous) {
  if (![current,previous].every(period => period?.available && period.received > 0 && period.receivedAmount > 0 && Number.isFinite(period.canceledAmountShare))) return null;
  return current.receivedAmount * (previous.canceledAmountShare - current.canceledAmountShare);
}

export function revenueWaterfall(current, previous, range, baseline, mode = 'yoy', scope = 'all') {
  const start = metric(previous.all,'shippedRevenue'), end = metric(current.all,'shippedRevenue');
  const s0 = metric(previous.site,'shippedRevenue'), s1 = metric(current.site,'shippedRevenue');
  const d0 = metric(previous.site,'shippedDocs'), d1 = metric(current.site,'shippedDocs');
  const r0 = metric(previous.rozetka,'shippedRevenue'), r1 = metric(current.rozetka,'shippedRevenue');
  const m0 = metric(previous.monomarket,'shippedRevenue'), m1 = metric(current.monomarket,'shippedRevenue');
  if ([start,end,s0,s1,d0,d1,r0,r1,m0,m1].includes(null) || d0 < 0 || d1 < 0) {
    return {available:false,range,comparisonRange:baseline,mode,notice:'Немає повної порівнюваної бази відвантажень.'};
  }

  const assortment = current.assortment;
  const newRevenue = assortment?.available && Number.isFinite(assortment.newRevenue) &&
    (scope !== 'all' || Number.isFinite(assortment.newSiteRevenue)) ? assortment.newRevenue : null;
  const newSiteRevenue = newRevenue === null || scope === 'marketplaces' ? 0
    : scope === 'site' ? newRevenue : assortment.newSiteRevenue;
  const newMarketplaceRevenue = (newRevenue ?? 0) - newSiteRevenue;
  const cancellationImpact = scope === 'marketplaces' ? null : orderLossImpact(current.orderLoss, previous.orderLoss);
  const cancellation = cancellationImpact ?? 0;
  const factors = [];
  let method = '';
  if (scope !== 'marketplaces') {
    const t0 = sessions(previous.traffic, baseline), t1 = sessions(current.traffic, range);
    const existingSiteRevenue = s1 - newSiteRevenue;
    if (d0 > 0 && d1 > 0) {
      const baselineCheck = s0 / d0;
      const afterOrders = d1 * baselineCheck;
      // Cancelled order value is reported separately from the order-volume effect.
      // Net sales of new SKUs are removed from the average-check contribution.
      if (t0 && t1) {
        const afterTraffic = s0 * t1 / t0;
        factors.push(
          {key:'traffic',label:'Трафік',value:afterTraffic - s0},
          {key:'conversion',label:'CR',value:afterOrders - afterTraffic - cancellation,
            description:'Внесок зміни відвантажених замовлень на сеанс GA4 після виділення ефекту скасувань.'},
        );
        method = 'CR базується на відвантажених замовленнях на сеанс GA4. Ефект скасувань виділено окремо.';
      } else {
        factors.push({key:'orders',label:'Замовлення',value:afterOrders - s0 - cancellation,
          description:'Трафік і CR об’єднані через брак порівнюваних сеансів GA4.'});
        method = 'Трафік і CR об’єднані через брак порівнюваних сеансів GA4.';
      }
      factors.push({key:'aov',label:'AOV',value:existingSiteRevenue-afterOrders,
        description:'Внесок середнього чека відвантажених замовлень без виторгу нових SKU.'});
    } else {
      factors.push({key:'site',label:'Виторг',value:existingSiteRevenue-s0-cancellation});
    }
    if (cancellationImpact !== null || (mode === 'yoy' && (current.orderLoss || previous.orderLoss))) {
      factors.push({key:'order-loss',label:'Ефект скасувань',value:cancellation});
    }
  }
  if (assortment) factors.push({key:'new-products',label:'Нові товари',value:newRevenue});
  if (scope !== 'site') factors.push({key:'marketplaces',label:'Маркетплейси',value:r1+m1-r0-m0-newMarketplaceRevenue});
  const other = end-s1-r1-m1-(start-s0-r0-m0);
  if (Math.abs(other) > .005) factors.push({key:'other',label:'Інші канали',value:other});

  let running = start;
  const steps = factors.map(factor => {
    const from = running;
    running += factor.value ?? 0;
    return {...factor,from,to:running};
  });
  return {available:true,range,comparisonRange:baseline,mode,scope,start,end,steps,method,residual:end-running,source:'ERP',updatedAt:new Date().toISOString()};
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
  const current = {all:scopedSales(data.sales,data.salesChannels,scope),traffic:data.channels,orderLoss:data.orderLoss?.current,
    assortment:data.assortment || {available:false}};
  const previous = {all:scopedSales(legacy?data.waterfallBaseline.all:data.sales.previous,old,scope),
    traffic:legacy?data.waterfallBaseline.traffic:data.channels?.previous,orderLoss:legacy?undefined:data.orderLoss?.previous};
  for (const id of ids) {
    const excluded = scope === 'site' ? id !== 'site' : scope === 'marketplaces' ? id === 'site' : false;
    current[id] = excluded ? zero : data.salesChannels[id];
    previous[id] = excluded ? zero : old[id];
  }
  return revenueWaterfall(current,previous,range,baseline,mode,scope);
}
