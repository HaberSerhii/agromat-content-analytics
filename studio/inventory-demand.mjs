import {inventoryMatrix,inventoryPrevious,inventoryPrioritySize} from './public/inventory-demand-filters.mjs';

export const baselineDays = 70;
export const stockRule = {
  minRevenue:5000, minViews:100, viewDays:7,
  stockThresholds:{'Плитка':20,'Сантехніка':3,'Підлогові покриття':20,'Будівельна хімія':3,'Зарядні станції':3},
};

const available = new Set([3,5]);
const unavailable = new Set([-1,1,2,4]);
const statusLabels = [null,'Немає в наявності','Очікується поставка','Під замовлення','Знято з виробництва','В наявності','В архіві'];
const forecastEpisodes = Symbol('forecastEpisodes');
export const observation = (status, archived, promo) => {
  const value = archived ? -1 : status;
  const state = available.has(value) ? 1 : unavailable.has(value) ? 2 : 0;
  const statusCode = state ? (value===-1 ? 6 : value) : 0;
  return state | (promo === true ? 4 : promo === false ? 8 : 0) | (statusCode << 4);
};
const stateAt = (item,index) => item.states[index] & 3;
const labelAt = (item,index) => statusLabels[item.states[index] >> 4];
const promoAt = (item,index) => item.states[index] & 4 ? 'yes' : item.states[index] & 8 ? 'no' : 'unknown';
const coveredSale = (data,index) => Boolean(data.salesCoverage[index]);
const sum = (values,key) => values.reduce((total,row)=>total+row[key],0);
const median = values => {
  const sorted = values.toSorted((a,b)=>a-b);
  const mid = Math.floor(sorted.length/2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
};
const average = (rows,key) => rows.length ? sum(rows,key)/rows.length : null;
const salesWeeks = rows => new Set(rows.filter(day=>day.revenue>0).map(day=>day.week)).size;

function baseline(data,item,anchor) {
  const begin = Math.max(0,anchor-baselineDays);
  const rows = [];
  let observed = 0, availableDays = 0;
  for (let i=begin;i<anchor;i++) {
    const state = stateAt(item,i);
    if (!state || !coveredSale(data,i)) continue;
    observed++;
    if (state !== 1) continue;
    availableDays++;
    if (!item.sales?.size) continue;
    const sale = item.sales?.get(i);
    rows.push({index:i,week:data.weeks[i],promo:promoAt(item,i),price:item.prices?.[data.fullIndex[i]] || null,
      revenue:sale?.revenue ?? 0,units:sale?.units ?? 0,cost:sale?.cost ?? 0,coveredRevenue:sale?.coveredRevenue ?? 0});
  }
  const regular = rows.filter(day=>day.promo==='no');
  const sample = regular.length >= 21 && salesWeeks(regular) >= 3 ? regular : rows;
  const saleDays = sample.filter(day=>day.revenue>0);
  const weeks = salesWeeks(sample);
  const mean = average(sample,'revenue');
  const eligible = sample.length >= 21 && saleDays.length >= 3 && weeks >= 3 && mean > 0;
  const flags = new Set();
  if (!eligible) flags.add('history');
  if (observed < baselineDays * .8) flags.add('gaps');
  if (rows.some(day=>day.promo==='unknown')) flags.add('promoUnknown');

  let backtest = null;
  if (eligible) {
    const weekly = new Map();
    for (const {week,revenue} of sample) weekly.set(week,(weekly.get(week) ?? 0)+revenue);
    const revenue = sum(sample,'revenue');
    if (Math.max(...weekly.values()) > revenue*.5) flags.add('concentration');
    const variation = Math.sqrt(sample.reduce((total,day)=>total+(day.revenue-mean)**2,0)/sample.length)/mean;
    if (variation > 2.5 || saleDays.length < 6) flags.add('irregular');
    const promo = rows.filter(day=>day.promo==='yes');
    const regularMean = average(regular,'revenue'), promoMean = average(promo,'revenue');
    if (promo.length && (sample===rows || (regularMean>0 && promoMean>regularMean*1.5))) flags.add('promo');
    const prices = sample.map(day=>day.price).filter(price=>price>0);
    if (prices.length >= 2 && Math.max(...prices)/Math.min(...prices)>1.2) flags.add('price');
    const training = sample.filter(day=>day.index<anchor-7);
    const holdout = sample.filter(day=>day.index>=anchor-7);
    const actual = sum(holdout,'revenue');
    if (training.length>=14 && salesWeeks(training)>=2 && holdout.length>=3 && actual>0) {
      const predicted = average(training,'revenue')*holdout.length;
      backtest = {days:holdout.length,actual,predicted,error:Math.abs(predicted-actual)/actual};
      if (backtest.error>.5) flags.add('error');
    } else {
      flags.add('validation');
    }
  }
  const coveredRevenue = sum(sample,'coveredRevenue'), revenue = sum(sample,'revenue');
  const marginRate = eligible && coveredRevenue>0 && coveredRevenue>=.9*revenue
    ? (coveredRevenue-sum(sample,'cost'))/coveredRevenue : null;
  if (eligible && (marginRate===null || coveredRevenue<revenue-.01)) flags.add('margin');
  const unstable = ['irregular','concentration','price','promo','error'].some(key=>flags.has(key));
  const confidence = !eligible ? null : unstable ? 'low' :
    observed>=56 && sample.length>=35 && backtest?.error<=.25 && !flags.has('promoUnknown') ? 'high' : 'medium';
  return {eligible, sampleDays:item.sales?.size ? sample.length : availableDays, saleDays:saleDays.length, weeks, confidence, backtest, marginRate,
    observedRevenue:sum(rows,'revenue'), observedSaleDays:rows.filter(day=>day.revenue>0).length,
    dailyRevenue:eligible ? mean : null,dailyUnits:eligible ? average(sample,'units') : null,
    confirmed:eligible && !flags.has('irregular') && !flags.has('concentration') && !flags.has('promo'),
    flags:[...flags]};
}

export function periodItem(data,item,range) {
  const start = data.index.get(range.from), end = data.index.get(range.to);
  let lastLoss = null, inDays = 0, outDays = 0, episode;
  const episodes = [];
  let previousState = stateAt(item,start-1);
  for (let i=start;i<=end;i++) {
    const state = stateAt(item,i);
    if (state===1) { inDays++; episode=null; }
    if (state===2) {
      if (!episode) { episode={from:i,to:i,days:0}; episodes.push(episode); }
      episode.to=i;
      episode.days++;
      outDays++;
      if (previousState===1) lastLoss = data.dates[i];
    }
    previousState = state;
  }
  if (!lastLoss) {
    for (let i=start-1;i>0;i--) {
      if (stateAt(item,i)===2 && stateAt(item,i-1)===1) { lastLoss = data.dates[i]; break; }
    }
  }
  const observedLoss = item.lossEvents?.findLast(date=>date<=range.to);
  if (observedLoss && (!lastLoss || observedLoss>lastLoss)) lastLoss=observedLoss;
  const status = ['unknown','in','out'][stateAt(item,end)];
  const observed = inDays+outDays;
  // A gap cannot establish a recovery. Keep the prior baseline if availability
  // had already been lost before the selected range.
  const first = episodes[0];
  if (first) {
    let anchor = first.from;
    for (let i=first.from-1;i>=0 && stateAt(item,i)!==1;i--) if (stateAt(item,i)===2) anchor=i;
    first.anchor=anchor;
  }
  let modeledDays=0, loss=0, lostUnits=0, margin=0, marginDays=0;
  const flags = new Set(), certainty = ['low','medium','high'];
  let confidence = null;
  for (const entry of episodes) {
    entry.history = baseline(data,item,entry.anchor ?? entry.from);
    const history = entry.history;
    for (const flag of history.flags) flags.add(flag);
    if (!history.eligible) continue;
    modeledDays += entry.days;
    const amount = history.dailyRevenue*entry.days;
    loss += amount;
    lostUnits += history.dailyUnits*entry.days;
    if (history.marginRate!==null) { margin += amount*history.marginRate; marginDays += entry.days; }
    if (confidence===null || certainty.indexOf(history.confidence)<certainty.indexOf(confidence)) confidence=history.confidence;
  }
  const history = episodes.at(-1)?.history ?? baseline(data,item,end+1);
  if (!episodes.length) {
    for (const flag of history.flags) flags.add(flag);
    confidence=history.confidence;
  }
  if (observed<(end-start+1)*.8) flags.add('gaps');
  if (modeledDays<outDays && modeledDays>0) flags.add('gaps');
  if (flags.has('gaps') && confidence==='high') confidence='medium';
  const lossKnown = modeledDays>0 || (!outDays && observed>0 && history.eligible);
  const dimensions = item.dimensions?.get(end) || item;
  const endPrice = item.prices?.[data.fullIndex[end]] || null;
  return {sampleDays:history.sampleDays,saleDays:history.saleDays,weeks:history.weeks,backtest:history.backtest,
    dailyRevenue:modeledDays ? loss/modeledDays : history.dailyRevenue,
    dailyUnits:modeledDays ? lostUnits/modeledDays : history.dailyUnits,
    confidence,flags:[...flags],confirmed:history.confirmed,
    code:item.code,sku:item.sku,name:item.name,category:dimensions.category,subcategory:dimensions.subcategory,
    brand:dimensions.brand,status,statusLabel:labelAt(item,end),promo:promoAt(item,end),price:endPrice,
    priceBand:endPrice===null?'unknown':endPrice<1000?'low':endPrice<5000?'middle':'high',
    outDays:observed ? outDays : null,lastLoss,modeledDays,marginDays,
    loss:lossKnown ? loss : null,lostUnits:lossKnown ? lostUnits : null,
    margin:marginDays || (lossKnown && !outDays && history.marginRate!==null) ? margin : null,
    [forecastEpisodes]:episodes,
    availabilityRate:observed >= Math.ceil((end-start+1)*.5) ? inDays/observed : null};
}

function historyForDay(row,index) {
  return row[forecastEpisodes].find(episode=>index>=episode.from && index<=episode.to)?.history;
}
function estimateForDay(row,index) {
  const history = historyForDay(row,index);
  return history?.eligible ? history : null;
}

function classify(rows) {
  const rates = new Map();
  for (const row of rows) {
    if (row.dailyUnits===null) continue;
    const group = rates.get(row.category) || [];
    group.push(row.dailyUnits);
    rates.set(row.category,group);
  }
  const thresholds = new Map([...rates].filter(([,rates])=>rates.length>=2).map(([key,rates])=>[key,median(rates)]));
  for (const row of rows) {
    const threshold = thresholds.get(row.category);
    row.demand = row.dailyUnits===null || threshold===undefined ? 'unknown' : row.dailyUnits>=threshold ? 'high' : 'low';
    row.quadrant = row.availabilityRate===null || row.demand==='unknown' ? null :
      row.demand==='high' ? (row.availabilityRate>=.9?'stable':'priority') : (row.availabilityRate>=.9?'excess':'low');
  }
}

function matched(row,filters) {
  for (const key of ['category','subcategory','brand']) if (filters[key] && row[key]!==filters[key]) return false;
  for (const key of ['status','demand','promo','quadrant']) if (filters[key]!=='all' && row[key]!==filters[key]) return false;
  if (filters.price!=='all' && row.priceBand!==filters.price) return false;
  if (Number(filters.minDays)>0 || Number(filters.maxDays)<90) {
    if (row.outDays===null || row.outDays<Number(filters.minDays) || row.outDays>Number(filters.maxDays)) return false;
  }
  if (!filters.search) return true;
  const haystack = `${row.code} ${row.sku ?? ''} ${row.name}`.toLocaleLowerCase('uk');
  return filters.search.toLocaleLowerCase('uk').split(/\s+/).every(word=>haystack.includes(word));
}

function totals(rows,covered) {
  const currentOut = rows.filter(row=>row.status==='out');
  const durations = rows.filter(row=>row.outDays>0);
  const losses = durations.filter(row=>row.loss!==null);
  const margins = losses.filter(row=>row.margin!==null);
  const statusKnown = rows.filter(row=>row.status!=='unknown').length;
  const hasStatus = covered && (!rows.length || statusKnown>0);
  return {out:hasStatus ? currentOut.length : null, confirmed:hasStatus ? currentOut.filter(row=>row.confirmed).length : null,
    averageDays:average(durations,'outDays'), loss:losses.length ? sum(losses,'loss') : null,
    margin:margins.length ? sum(margins,'margin') : null, modeled:losses.length, marginSku:margins.length,
    impacted:durations.length,statusKnown};
}

function ranking(rows,key) {
  const grouped = new Map();
  for (const row of rows) {
    if (!(row.loss>0)) continue;
    grouped.set(row[key],(grouped.get(row[key]) ?? 0)+row.loss);
  }
  return [...grouped].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0],'uk')).slice(0,10);
}

function trend(data,rows,start,end) {
  const days = [];
  for (let index=start;index<=end;index++) {
    const actualKnown = coveredSale(data,index);
    let actual=0, units=0, loss=0, lostUnits=0, known=0, unresolved=0, unmodeled=0;
    for (const row of rows) {
      const item = data.items.get(row.code);
      const sale = item.sales?.get(index);
      actual += sale?.revenue ?? 0;
      units += sale?.units ?? 0;
      const state = stateAt(item,index);
      if (state) known++;
      if (!state) unresolved++;
      if (state===2) {
        const estimate = estimateForDay(row,index);
        if (estimate) { loss+=estimate.dailyRevenue; lostUnits+=estimate.dailyUnits; }
        else unmodeled++;
      }
    }
    const estimated = known>0 && (loss>0 || !unmodeled);
    days.push({date:data.dates[index],actual:actualKnown ? actual : null, units:actualKnown ? units : null,
      loss:estimated ? loss : null,lostUnits:estimated ? lostUnits : null,partial:unresolved>0 || unmodeled>0});
  }
  return days;
}

function priorityForDay(data,rows,day) {
  const index = data.index.get(day.date);
  const ranking = [], evidence = [];
  let out=0, known=0, marginSku=0, margin=0;
  for (const row of rows) {
    const item = data.items.get(row.code);
    const state = stateAt(item,index);
    if (state) known++;
    if (state!==2) continue;
    out++;
    const history = historyForDay(row,index);
    if (!history || (!history.eligible && !(history.observedRevenue>0))) continue;
    let outDays = 1;
    for (let i=index-1;i>=0 && stateAt(item,i)===2;i--) outDays++;
    const entry = {code:row.code,name:row.name,brand:row.brand,statusLabel:labelAt(item,index),outDays};
    if (history.eligible) {
      const loss = history.dailyRevenue;
      const estimatedMargin = history.marginRate===null ? null : loss*history.marginRate;
      if (estimatedMargin!==null) { marginSku++; margin+=estimatedMargin; }
      ranking.push({...entry,loss,margin:estimatedMargin,confidence:history.confidence});
    } else {
      evidence.push({...entry,revenue:history.observedRevenue,saleDays:history.observedSaleDays});
    }
  }
  const byCode = (a,b) => a.code.localeCompare(b.code,'uk',{numeric:true});
  ranking.sort((a,b)=>Number(a.margin===null)-Number(b.margin===null) ||
    (b.margin ?? 0)-(a.margin ?? 0) || b.loss-a.loss || byCode(a,b));
  evidence.sort((a,b)=>b.revenue-a.revenue || byCode(a,b));
  const statusAvailable = Boolean(data.statusCoverage[index]) && (!rows.length || known>0);
  return {date:day.date,actual:day.actual,loss:day.loss,expected:day.actual===null || day.loss===null ? null : day.actual+day.loss,
    partial:day.partial,statusAvailable,out:statusAvailable ? out : null,modeled:ranking.length,marginSku,
    margin:marginSku ? margin : null,evidenceCount:evidence.length,
    rows:ranking.slice(0,inventoryPrioritySize),evidence:evidence.slice(0,inventoryPrioritySize)};
}

export function inventoryAnalysis(data,selection) {
  const current = {from:selection.from,to:selection.to}, previous = inventoryPrevious(current);
  const previousEnd = data.index.get(previous.to), end = data.index.get(current.to);
  const rows = [], prior = [];
  for (const item of data.items.values()) {
    if (item.archivedBeforeRange) continue;
    if (!item.firstSeen || item.firstSeen<=current.to) rows.push(periodItem(data,item,current));
    if (!item.firstSeen || item.firstSeen<=previous.to) prior.push(periodItem(data,item,previous));
  }
  classify(rows);
  classify(prior);
  const chosen = rows.filter(row=>matched(row,selection));
  const previousRows = prior.filter(row=>matched(row,selection));
  const start = data.index.get(current.from);
  const previousStart = data.index.get(previous.from);
  const knownDays = (from,to,field) => data[field].slice(from,to+1).reduce((total,value)=>total+Number(Boolean(value)),0);
  const currentDays = knownDays(start,end,'statusCoverage'), previousDays = knownDays(previousStart,previousEnd,'statusCoverage');
  const statusCounts = Object.fromEntries(Object.keys(inventoryMatrix).map(key=>[key,0]));
  for (const row of chosen) if (row.quadrant) statusCounts[row.quadrant]++;
  const byCode = new Map(chosen.map(row=>[row.code,row]));
  const watchRows = data.stockWatch.rows.filter(row=>byCode.has(row.code)).map(row=>({...row,...byCode.get(row.code)}));
  const table = selection.view==='all' ? chosen : selection.view==='watch' ? watchRows : watchRows.filter(row=>row.watchStatus==='low');
  const chart = trend(data,chosen,start,end);
  const distinct = (rows,key) => [...new Set(rows.map(row=>row[key]))].sort((a,b)=>a.localeCompare(b,'uk'));
  return {range:current,previous,coverage:{current:currentDays,previous:previousDays,days:end-start+1,
    sales:knownDays(start,end,'salesCoverage'), previousSales:knownDays(previousStart,previousEnd,'salesCoverage'),
    asOf:Boolean(data.statusCoverage[end]), updatedAt:data.updatedAt},
    current:totals(chosen,data.statusCoverage[end]),prior:totals(previousRows,data.statusCoverage[previousEnd]),
    categories:ranking(chosen,selection.category?'subcategory':'category'),brands:ranking(chosen,'brand'),matrix:statusCounts,
    chart,table,priorityFor:date=>priorityForDay(data,chosen,chart[data.index.get(date)-start]),
    facets:{categories:distinct(rows,'category'),subcategories:distinct(rows.filter(row=>!selection.category || row.category===selection.category),'subcategory'),brands:distinct(rows,'brand')},
    stockWatch:{...data.stockWatch,rows:undefined,monitored:watchRows.length,alerts:watchRows.filter(row=>row.watchStatus==='low').length}};
}

export function compareInventory(a,b,{sort,direction}) {
  const ranks = {low:1,medium:2,high:3}, statusRank = {unknown:0,in:1,out:2};
  const value = row => sort==='confidence' ? ranks[row.confidence] : sort==='status' ? statusRank[row.status] : row[sort];
  const x = value(a), y = value(b);
  if (x==null || y==null) {
    if (x!=null) return -1;
    if (y!=null) return 1;
    return (sort==='loss' ? (b.outDays ?? -1)-(a.outDays ?? -1) : 0) || a.code.localeCompare(b.code,'uk',{numeric:true});
  }
  const diff = typeof x==='number' ? x-y : x.localeCompare(y,'uk',{numeric:true});
  return diff*(direction==='asc'?1:-1) || a.code.localeCompare(b.code,'uk',{numeric:true});
}

export function inventoryDetail(data,item,range) {
  const start = data.index.get(range.from), end = data.index.get(range.to);
  const row = periodItem(data,item,range);
  const days = [], outages = [];
  let outage = null;
  for (let index=start;index<=end;index++) {
    const status = ['unknown','in','out'][stateAt(item,index)];
    const sale = item.sales?.get(index);
    const day = {date:data.dates[index],status,statusLabel:labelAt(item,index),promo:promoAt(item,index),price:item.prices?.[data.fullIndex[index]] || null,
      revenue:coveredSale(data,index) ? (sale?.revenue ?? 0) : null,
      units:coveredSale(data,index) ? (sale?.units ?? 0) : null,
      loss:status==='out' ? estimateForDay(row,index)?.dailyRevenue ?? null : status==='in' ? 0 : null};
    days.push(day);
    if (status==='out') {
      if (!outage) { outage={from:day.date,to:day.date,days:0}; outages.push(outage); }
      outage.to=day.date;
      outage.days++;
    } else {
      outage=null;
    }
  }
  return {row,days,outages};
}
