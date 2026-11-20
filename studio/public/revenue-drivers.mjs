import { comparisonRange, scopedSales } from './overview-filters.mjs';

export const waterfallComparison = (range, mode = 'yoy') => comparisonRange(range, mode === 'month' ? 'mom' : mode);
const metric = (source, key) => source?.available && Number.isFinite(source.metrics?.[key]) ? source.metrics[key] : null;
const receivedCheck = period => period?.available && period.received > 0 && Number.isFinite(period.receivedAmount)
  ? period.receivedAmount / period.received : null;
const decimal = new Intl.NumberFormat('uk-UA', {maximumFractionDigits:2});
const signed = new Intl.NumberFormat('uk-UA', {maximumFractionDigits:2,signDisplay:'exceptZero'});
const uah = value => `${decimal.format(value)} ₴`;
const signedUah = value => `${signed.format(value)} ₴`;
const compare = (metric, unit, previous, current, explanation, estimated) =>
  ({metric,unit,previous,current,explanation,estimated});

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
    const cancellationEffect = orderLossImpact(current.orderLoss, previous.orderLoss);
    const cancellation = cancellationEffect ?? (mode === 'yoy' ? 0 : null);
    const estimated = [previous.orderLoss?.estimated, current.orderLoss?.estimated];
    const t0 = sessions(previous.traffic, baseline), t1 = sessions(current.traffic, range);
    const aov0 = receivedCheck(previous.orderLoss), aov1 = receivedCheck(current.orderLoss);
    const acov0 = d0 > 0 ? s0 / d0 : null, acov1 = d1 > 0 ? s1 / d1 : null;
    let aovImpact = null, acovImpact = null;
    if (d0 > 0 && d1 > 0) {
      const afterOrders = d1 * acov0;
      // Both check effects use the same shipped-order count so they sum to the change in the shipped check.
      const shippedCheckImpact = s1 - afterOrders;
      if (aov0 !== null && aov1 !== null) aovImpact = d1 * (aov1 - aov0);
      acovImpact = shippedCheckImpact - (aovImpact ?? 0);
      if (t0 && t1) {
        const afterTraffic = s0 * t1 / t0;
        factors.push(
          {key:'traffic',label:'Трафік',value:afterTraffic - s0,
            comparison:compare('Сеанси GA4', 'count', t0, t1,
              `Виторг сайту за базовий період (${uah(s0)}) × зміна кількості сеансів (${signed.format((t1/t0-1)*100)}%). Конверсія і чек зафіксовані на базовому рівні.`)},
          {key:'conversion',label:'CR',value:afterOrders - afterTraffic - (cancellation ?? 0),
            comparison:compare('Виконані замовлення на сеанс', '%', d0/t0*100, d1/t1*100,
              `Зміна CR × ${decimal.format(t1)} поточних сеансів × базовий ACOV (${uah(acov0)}).${cancellation
                ? ` З отриманих ${signedUah(afterOrders-afterTraffic)} віднято окремий внесок скасувань (${signedUah(cancellation)}).` : ''}`)},
        );
        method = 'CR базується на відвантажених замовленнях на сеанс GA4. Ефект скасувань виділено окремо.';
      } else {
        factors.push({key:'orders',label:'Замовлення',value:afterOrders - s0 - (cancellation ?? 0),
          comparison:compare('Виконані замовлення', 'count', d0, d1,
            `Зміна кількості виконаних замовлень × базовий ACOV (${uah(acov0)}).${cancellation
              ? ` Віднято окремий внесок скасувань (${signedUah(cancellation)}).` : ''} Спільний внесок трафіку й CR через брак порівнюваних сеансів GA4.`)});
        method = 'Трафік і CR об’єднані через брак порівнюваних сеансів GA4.';
      }
    } else {
      factors.push({key:'site',label:'Виторг',value:s1-s0-(cancellation ?? 0),
        comparison:compare('Виторг сайту', '₴', s0, s1,
          `Зміна відвантаженого виторгу.${cancellation ? ` Віднято окремий внесок скасувань (${signedUah(cancellation)}).` : ''} Для розподілу за трафіком, CR і чеком потрібні виконані замовлення за обидва періоди.`)});
    }
    const c0 = previous.orderLoss?.available ? previous.orderLoss.canceledAmountShare : null;
    const c1 = current.orderLoss?.available ? current.orderLoss.canceledAmountShare : null;
    factors.push(
      {key:'aov',label:'AOV',value:aovImpact,
        comparison:compare('Середній чек отриманих замовлень сайту', '₴', aov0, aov1, aovImpact === null
          ? 'Для розрахунку потрібен отриманий чек за обидва періоди та виконані замовлення за обидва періоди.'
          : `Зміна отриманого чека (${signedUah(aov1-aov0)}) × ${decimal.format(d1)} виконаних замовлень за вибраний період.`, estimated)},
      {key:'acov',label:'ACOV',value:acovImpact,
        comparison:compare('Середній чек виконаних замовлень після повернень', '₴', acov0, acov1, acovImpact === null
          ? 'Для порівняння потрібні виконані замовлення за обидва періоди.'
          : aovImpact === null
          ? `Зміна виконаного чека (${signedUah(acov1-acov0)}) × ${decimal.format(d1)} виконаних замовлень. Отриманий чек недоступний за один або обидва періоди.`
          : `Зміна виконаного чека (${signedUah(acov1-acov0)}) мінус зміна отриманого чека (${signedUah(aov1-aov0)}). Різницю помножено на ${decimal.format(d1)} виконаних замовлень.`)},
      {key:'order-loss',label:'Скасування',value:cancellation,
        comparison:compare('Частка вартості скасованих замовлень', '%', Number.isFinite(c0) ? c0*100 : null, Number.isFinite(c1) ? c1*100 : null,
          cancellationEffect === null ? (mode === 'yoy'
            ? 'Для одного або обох періодів бракує даних. У річному порівнянні внесок показано як 0 ₴.'
            : 'Для розрахунку потрібна порівнювана вартість замовлень і скасувань за обидва періоди.')
            : `Базова частка мінус поточна (${signed.format((c0-c1)*100)} п. п.) × ${estimated[1] ? '≈' : ''}${uah(current.orderLoss.receivedAmount)} отриманих замовлень. Збільшення частки зменшує внесок.`, estimated)},
    );
  }
  if (scope !== 'site') factors.push({key:'marketplaces',label:'Маркетплейси',value:r1+m1-r0-m0,
    comparison:compare('Відвантажений виторг маркетплейсів', '₴', r0+m0, r1+m1,
      `Зміна виторгу Rozetka (${signedUah(r1-r0)}) і Monomarket (${signedUah(m1-m0)}).`)});
  const other0 = start-s0-r0-m0, other1 = end-s1-r1-m1;
  if (Math.abs(other1-other0) > .005) factors.push({key:'other',label:'Інші канали',value:other1-other0,
    comparison:compare('Відвантажений виторг інших каналів', '₴', other0, other1,
      'Різниця між виторгом інших каналів за два періоди.')});

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
