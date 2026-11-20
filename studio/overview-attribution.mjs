import {goodsOnlySalesRow,netSalesItems} from './erp-items.mjs';
import {comparisonRange,rangeDays} from './public/overview-filters.mjs';
import {calendarBins} from './public/chart-periods.mjs';

export function validateSelection(input) {
  const state = Object.fromEntries(['from','to','compareMode','salesScope','acquisition','device'].map(key=>[key,input[key]]));
  for (const date of [state.from,state.to]) if (!/^\d{4}-\d{2}-\d{2}$/.test(date||'') || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date) throw Error('invalid_range');
  if (rangeDays(state)<1 || rangeDays(state)>365) throw Error('invalid_range');
  for (const [key,values] of Object.entries({compareMode:['wow','mom','yoy'],salesScope:['all','site','marketplaces'],acquisition:['all','direct','organic','cpc'],device:['all','mobile','desktop']})) if(!values.includes(state[key])) throw Error('invalid_filter');
  if (state.salesScope==='marketplaces' && (state.acquisition!=='all'||state.device!=='all')) throw Error('marketplace_web_filter');
  comparisonRange(state,state.compareMode);
  return state;
}

export function transactionIndex(rows) {
  const map = new Map();
  for (const row of rows) {
    const id = String(row.transactionId||'').trim();
    if (!id || ['0','(not set)','(other)'].includes(id)) continue;
    const entry=map.get(id)||{acquisitions:new Set(),devices:new Set()};
    entry.acquisitions.add(row.acquisition||'other');entry.devices.add(row.device||'other');map.set(id,entry);
  }
  return new Map([...map].map(([id,value])=>[id,{acquisition:value.acquisitions.size===1?[...value.acquisitions][0]:null,device:value.devices.size===1?[...value.devices][0]:null,ambiguous:value.acquisitions.size>1||value.devices.size>1}]));
}

const inRange=(date,range)=>date&&date>=range.from&&date<=range.to;
const shipped=row=>!!row.shippedDate&&String(row.state).toLocaleLowerCase('uk').includes('повністю відвантаж');
const excluded=row=>['створення нового замовлення','дубль замовлення','фейкове замовлення','попередній прорахунок'].some(reason=>String(row.cancelReason||'').toLocaleLowerCase('uk').replace(/\s+/g,' ').includes(reason));
export const erpChannel=(row,rozetka)=>row.cartNumber?'monomarket':row.webshopId&&rozetka.has(String(row.webshopId))?'rozetka':'site';

function addQuantity(total, value) {
  if (!value) {
    total.missingQuantityLines = (total.missingQuantityLines || 0) + 1;
    return;
  }
  const quantities = total.quantities ||= Object.create(null);
  quantities[value.unit] = (quantities[value.unit] || 0) + value.quantity;
}

function salesAggregate(records,range,quantities) {
  const byDate=new Map(),brands=new Map(),categories=new Map();
  let revenue=0,docs=0,goods=0,canceled=0;
  const group=(map,label,item,ref,quantity)=>{
    label=label||'Не визначено';
    const row=map.get(label)||{label,revenue:0,goods:0,refs:new Set()};
    row.revenue+=item.revenue;row.goods+=item.qty||0;row.refs.add(ref);map.set(label,row);
    addQuantity(row, quantity);
  };
  for (const {row} of records) {
    if (excluded(row)) continue;
    const statusDate=row.shippedDate||row.createdDate;
    if (inRange(statusDate,range)&&String(row.state).toLocaleLowerCase('uk').includes('скас')) {
      canceled++;const day=byDate.get(statusDate)||{date:statusDate,revenue:0,docs:0,goods:0,canceled:0};day.canceled++;byDate.set(statusDate,day);
    }
    if (!shipped(row)||!inRange(row.shippedDate,range)) continue;
    const net=row.docsSum-row.returnSum,items=netSalesItems(row);
    revenue+=net;docs++;goods+=row.goodsCount;
    const day=byDate.get(row.shippedDate)||{date:row.shippedDate,revenue:0,docs:0,goods:0,canceled:0};
    day.revenue+=net;day.docs++;day.goods+=row.goodsCount;byDate.set(day.date,day);
    for (const [index,item] of items.entries()) {
      const quantity = quantities?.get(row.items[index]);
      group(brands,item.brand,item,row.docsRef,quantity);
      group(categories,item.category,item,row.docsRef,quantity);
    }
  }
  const buckets=map=>[...map.values()].map(({refs,...row})=>({...row,docs:refs.size})).sort((a,b)=>b.revenue-a.revenue);
  return {available:true,hasData:docs>0||canceled>0,range,metrics:{shippedRevenue:revenue,shippedDocs:docs,shippedGoods:goods,canceledDocs:canceled},byDate:[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)),brands:buckets(brands),categories:buckets(categories)};
}

function salesBreakdown(records, range, lastYear, matches, pastMatches, quantities) {
  const pairs = new Map();
  const add = (row, items, period) => {
    for (const [index,item] of items.entries()) {
      const category = item.category || 'Не визначено', brand = item.brand || 'Не визначено';
      const key = JSON.stringify([category, brand]);
      const pair = pairs.get(key) || {category, brand};
      const totals = pair[period] ||= {revenue:0, goods:0};
      totals.revenue += item.revenue;
      totals.goods += item.qty || 0;
      addQuantity(totals, quantities?.get(row.items[index]));
      pairs.set(key, pair);
    }
  };
  for (const record of records) {
    const {row} = record;
    if (!shipped(row) || excluded(row)) continue;
    const current = inRange(row.shippedDate, range) && matches(record.match);
    const prior = pastMatches && inRange(row.shippedDate, lastYear) && pastMatches(record);
    if (!current && !prior) continue;
    const items = netSalesItems(row);
    if (current) add(row, items, 'current');
    if (prior) add(row, items, 'previous');
  }
  return {range, lastYear, previousAvailable: Boolean(pastMatches), pairs:[...pairs.values()]};
}

function shipmentMargin(records, range, margins) {
  const byDate = new Map();
  const totals = () => ({amount:0, coveredRevenue:0, coveredDocs:0, docs:0, coveredLines:0, lines:0});
  const overall = totals();
  const byChannel = {site:totals(), rozetka:totals(), monomarket:totals()};
  for (const {row, channel} of records) {
    if (!inRange(row.shippedDate, range) || !shipped(row) || excluded(row)) continue;
    const day = byDate.get(row.shippedDate) || {date:row.shippedDate, amount:null, coveredRevenue:0};
    byDate.set(day.date, day);
    let amount = 0, coveredRevenue = 0, coveredLines = 0;
    for (const [index, item] of netSalesItems(row).entries()) {
      const rate = margins?.get(row.items[index]);
      if (!Number.isFinite(rate)) continue;
      amount += item.revenue * rate / 100;
      coveredRevenue += item.revenue;
      coveredLines++;
    }
    for (const total of [overall, byChannel[channel]]) {
      total.docs++;
      total.lines += row.items.length;
      total.amount += amount;
      total.coveredRevenue += coveredRevenue;
      total.coveredLines += coveredLines;
      if (coveredLines) total.coveredDocs++;
    }
    if (coveredLines) {
      day.amount = (day.amount ?? 0) + amount;
      day.coveredRevenue += coveredRevenue;
    }
  }
  const summarize = total => ({
    ...total,
    amount:total.coveredLines ? total.amount : null,
    percent:total.coveredRevenue > 0 ? total.amount / total.coveredRevenue * 100 : null,
  });
  return {
    ...summarize(overall), byDate:[...byDate.values()],
    byChannel:Object.fromEntries(Object.entries(byChannel).map(([key, total]) => [key, summarize(total)])),
  };
}

export function buildOverviewAttribution({rows,quantities,margins,transactions,previousYearTransactions,webRows,rozetkaIds,updatedAt},input,{includeMargin = false} = {}) {
  const state=validateSelection(input),range={from:state.from,to:state.to},baseline=comparisonRange(range,state.compareMode);
  const rozetka=new Set(rozetkaIds),index=transactionIndex(transactions);
  const seen=new Set(),records=[];
  for (const raw of rows) {
    if(seen.has(raw.docsRef))throw Error('duplicate_erp_document');seen.add(raw.docsRef);
    const row=goodsOnlySalesRow(raw);if(!row)continue;
    const channel=erpChannel(row,rozetka),match=channel==='site'&&row.webshopId?index.get(String(row.webshopId)):null;
    records.push({row,channel,match});
  }
  // An ERP snapshot of open orders, independent of the sales history range.
  const readyToShip = {revenue:0, docs:0, updatedAt};
  for (const {row} of records) {
    if (String(row.state).trim().toLocaleLowerCase('uk') !== 'відвантаження дозволено' || excluded(row)) continue;
    readyToShip.revenue += row.docsSum - row.returnSum;
    readyToShip.docs++;
  }
  const matches=match=>(state.acquisition==='all'||match?.acquisition===state.acquisition)&&(state.device==='all'||match?.device===state.device);
  const filtered=records.filter(record=>matches(record.match));
  const aggregate=selection=>({...salesAggregate(selection,range,quantities),updatedAt,previous:{...salesAggregate(selection,baseline,quantities),updatedAt}});
  const sales=aggregate(filtered),salesChannels=Object.fromEntries(['site','rozetka','monomarket'].map(channel=>[channel,aggregate(filtered.filter(row=>row.channel===channel))]));
  const lastYear = comparisonRange(range, 'yoy');
  const scopedRecords = records.filter(({channel}) => state.salesScope === 'all' || (channel === 'site') === (state.salesScope === 'site'));
  const pastIndex = previousYearTransactions && transactionIndex(previousYearTransactions);
  const pastMatches = previousYearTransactions === null ? null : ({row, channel, match}) =>
    matches(pastIndex ? (channel === 'site' ? pastIndex.get(String(row.webshopId)) : null) : match);
  const breakdown = salesBreakdown(scopedRecords, range, lastYear, matches, pastMatches, quantities);
  const preview = {};
  if (includeMargin) {
    const selected = scopedRecords.filter(record => matches(record.match));
    preview.margin = {
      ...shipmentMargin(selected, range, margins),
      previous:shipmentMargin(selected, baseline, margins),
    };
  }
  const coverage=period=>{
    const selected=records.filter(record=>record.channel==='site'&&shipped(record.row)&&inRange(record.row.shippedDate,period)&&!excluded(record.row));
    const count=test=>selected.filter(test).length;
    return {docs:selected.length,matchedDocs:count(record=>record.match&&!record.match.ambiguous),sourceDocs:count(record=>!!record.match?.acquisition),deviceDocs:count(record=>!!record.match?.device),missingIdDocs:count(record=>!record.row.webshopId),ambiguousDocs:count(record=>!!record.match?.ambiguous),unmatchedDocs:count(record=>!record.match)};
  };
  const webMap=new Map(webRows.map(row=>[JSON.stringify([row.key,row.acquisition,row.device]),row]));
  const get=(key,acquisition=state.acquisition)=>webMap.get(JSON.stringify([key,acquisition,state.device]));
  const webSource=(key,period)=>{
    if(state.salesScope==='marketplaces')return {available:false,range:period,notice:'GA4 сайту не вимірює трафік маркетплейсів.'};
    const coverage=get(key,'all'),row=get(key);
    if(!coverage?.data_through)return {available:false,range:period};
    const through=String(coverage.data_through),from=String(coverage.data_from),complete=from<=period.from&&through>=period.to;
    return {available:true,hasData:true,users:Number(row?.users||0),sessions:Number(row?.sessions||0),purchases:Number(row?.purchases||0),dataFrom:from,dataThrough:through,complete,range:period,stages:['landing','view_item','cart','begin_checkout','purchase'].map(stage=>({key:stage,value:Number(row?.[stage]||0)}))};
  };
  const currentWeb=webSource('current',range),previousWeb=webSource('previous',baseline);
  const users={...currentWeb,previous:previousWeb,definition:'Унікальні користувачі України · GA4 BigQuery'};
  const trafficRows=key=>['direct','organic','cpc','other'].filter(channel=>state.acquisition==='all'||channel===state.acquisition).map(channel=>({channel,sessions:Number(get(key,channel)?.sessions||0),purchases:Number(get(key,channel)?.purchases||0)}));
  const channels={...currentWeb,rows:trafficRows('current'),previous:{...previousWeb,rows:trafficRows('previous')}};
  const periods=state.salesScope==='marketplaces'?[]:webRows.filter(row=>row.acquisition==='all'&&row.device===state.device&&row.key.includes(':')).map(base=>({key:base.key,users:Number(get(base.key)?.users||0),hasData:true,dataThrough:base.data_through}));
  const days=periods.filter(row=>row.key.split(':')[0]===row.key.split(':')[1]).map(row=>{const web=get(row.key);return {date:row.key.split(':')[0],sessions:Number(web?.sessions||0),purchases:Number(web?.purchases||0)};});
  const webPeriods=periods.map(row=>({key:row.key,sessions:Number(get(row.key)?.sessions||0),purchases:Number(get(row.key)?.purchases||0)}));
  const trafficGroups=[{id:'direct',name:'Direct',color:'#533afd'},{id:'organic',name:'Organic',color:'#8d7afb'},{id:'cpc',name:'CPC',color:'#baaefa'},{id:'other',name:'Інше',color:'#d6d7df'}].filter(group=>state.acquisition==='all'||group.id===state.acquisition);
  const trafficBins=calendarBins(range,rangeDays(range)>90?'month':rangeDays(range)>31?'week':'day');
  const quarterTraffic={available:currentWeb.available,range,groups:trafficGroups,weeks:trafficBins.filter(bin=>get(bin.from+':'+bin.to,'all')?.data_through).map(bin=>{const key=bin.from+':'+bin.to,counts=Object.fromEntries(trafficGroups.map(group=>[group.id,Number(get(key,group.id)?.sessions||0)]));return {...bin,counts,total:trafficGroups.reduce((sum,group)=>sum+counts[group.id],0)};})};
  return {available:true,range,comparisonRange:baseline,readyToShip,sales,salesChannels,breakdown,...preview,users,channels,quarterTraffic,history:{available:true,range,users:{available:currentWeb.available||previousWeb.available,periods},web:{available:currentWeb.available||previousWeb.available,days,periods:webPeriods}},siteFunnel:{available:currentWeb.available,current:currentWeb,previous:previousWeb,comparisonMode:state.compareMode,selection:true},attribution:{current:coverage(range),previous:coverage(baseline),updatedAt,definition:'ERP webshopId = GA4 transaction_id; джерело й пристрій лише з однозначного збігу'},updatedAt};
}
