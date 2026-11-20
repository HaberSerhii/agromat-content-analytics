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

  const factors = [];
  let method = '';
  if (scope !== 'marketplaces') {
    const t0 = sessions(previous.traffic, baseline), t1 = sessions(current.traffic, range);
    const received0 = previous.orderLoss, received1 = current.orderLoss;
    const cancellationImpact = orderLossImpact(received1, received0);
    if (cancellationImpact !== null) {
      // Attribute the change in retained order value, then reconcile it to ERP shipments.
      const baselineRetained = 1 - received0.canceledAmountShare;
      const baselineReceived = received0.receivedAmount;
      const afterOrders = received1.received * (baselineReceived / received0.received);
      const afterTraffic = t0 && t1 ? baselineReceived * t1 / t0 : baselineReceived;
      if (t0 && t1) factors.push({key:'traffic',label:'Сайт: трафік',value:(afterTraffic-baselineReceived)*baselineRetained});
      factors.push(
        {key:t0 && t1 ? 'conversion' : 'orders',label:t0 && t1 ? 'Сайт: конверсія' : 'Сайт: замовлення',value:(afterOrders-afterTraffic)*baselineRetained},
        {key:'aov',label:'Сайт: чек',value:(received1.receivedAmount-afterOrders)*baselineRetained},
        {key:'order-loss',label:'Ефект скасувань',value:cancellationImpact},
      );
      const retainedDelta = (received1.receivedAmount - received1.canceledAmount) - (baselineReceived - received0.canceledAmount);
      const shipmentBridge = (s1-s0) - retainedDelta;
      if (Math.abs(shipmentBridge) > .005) factors.push({key:'shipment-bridge',label:'Різниця відвантажень',value:shipmentBridge});
      method = 'Фактори сайту включають вхідні дзвінки. Конверсія відносить отримані замовлення ERP до сеансів GA4. Різниця відвантажень враховує різні дати створення й відвантаження, відкриті замовлення та повернення.';
      if (received0.estimated || received1.estimated) method += ' Для замовлень без суми використано середній чек отриманих замовлень.';
    } else if (d0 > 0 && d1 > 0) {
      // Revenue = GA4 sessions × (ERP shipped orders / GA4 sessions) × ERP shipped AOV.
      const baselineCheck = s0 / d0;
      const afterOrders = d1 * baselineCheck;
      if (t0 && t1) {
        const afterTraffic = t1 * (d0 / t0) * baselineCheck;
        factors.push(
          {key:'traffic',label:'Сайт: трафік',value:afterTraffic - s0},
          {key:'conversion',label:'Сайт: конверсія',value:afterOrders - afterTraffic},
        );
        method = 'Конверсія сайту тут — відвантажені замовлення ERP / сеанси GA4.';
      } else {
        factors.push({key:'orders',label:'Сайт: замовлення',value:afterOrders - s0});
        method = 'Трафік і конверсію об’єднано у зміну замовлень: бракує порівнюваних сеансів GA4.';
      }
      factors.push({key:'aov',label:'Сайт: чек',value:s1 - afterOrders});
    } else {
      factors.push({key:'site',label:'Сайт',value:s1-s0});
      method = 'Зміна сайту показана загалом: в одному з періодів немає відвантажених замовлень.';
    }
    if (mode === 'yoy' && cancellationImpact === null && (received0 || received1)) {
      factors.push({key:'order-loss',label:'Ефект скасувань',value:0});
    }
  }
  if (scope !== 'site') factors.push({key:'marketplaces',label:'Маркетплейси',value:r1+m1-r0-m0});
  const other = end-s1-r1-m1-(start-s0-r0-m0);
  if (Math.abs(other) > .005) factors.push({key:'other',label:'Інші канали',value:other});

  let running = start;
  const steps = factors.map(factor => {
    const from = running;
    running += factor.value;
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
  const current = {all:scopedSales(data.sales,data.salesChannels,scope),traffic:data.channels,orderLoss:data.orderLoss?.current};
  const previous = {all:scopedSales(legacy?data.waterfallBaseline.all:data.sales.previous,old,scope),
    traffic:legacy?data.waterfallBaseline.traffic:data.channels?.previous,orderLoss:legacy?undefined:data.orderLoss?.previous};
  for (const id of ids) {
    const excluded = scope === 'site' ? id !== 'site' : scope === 'marketplaces' ? id === 'site' : false;
    current[id] = excluded ? zero : data.salesChannels[id];
    previous[id] = excluded ? zero : old[id];
  }
  return revenueWaterfall(current,previous,range,baseline,mode,scope);
}
