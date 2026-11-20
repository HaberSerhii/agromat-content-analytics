import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOverviewAttribution,transactionIndex,validateSelection} from '../overview-attribution.mjs';
import {comparisonRange,comparisonAvailability,validComparison,scopedSales,overviewControls,overviewDefaults,selectedHistory} from '../public/overview-filters.mjs';
import {overviewRevenueWaterfall} from '../public/revenue-drivers.mjs';
import {periodChannelRows,overviewModel,renderBusinessOverview,renderOrderLoss,renderSalesBreakdown} from '../public/business-overview.mjs';
import {overviewWebQuery,overviewTransactionsQuery,readBoundedTransactions,readBoundedWeb} from '../overview-query.mjs';
import {apiParams} from '../public/api-cache.mjs';
import {historySeries} from '../public/weekly-charts.mjs';

const selection={from:'2026-11-11',to:'2026-11-17',compareMode:'wow',salesScope:'all',acquisition:'all',device:'all',yoy:true,chartChannel:'all',chartSegment:'Усі'};
const item=(revenue,code='1',category='Плитка',brand='A')=>({code,name:'Товар',category,brand,qty:1,revenue});
const order=(id,revenue,extra={})=>({docsRef:'erp-'+id,number:String(id),webshopId:String(id),state:'повністю відвантажено',createdDate:'2026-10-31',shippedDate:'2026-11-12',cartNumber:'',cancelReason:'',docsSum:revenue,returnSum:0,goodsCount:1,items:[item(revenue)],returnGoodsCodes:[],returnRowSums:[],...extra});
const fixture=()=>({rows:[order(101,100),order(102,200),order(103,300,{webshopId:''}),order(500,400),order(600,500,{cartNumber:'cart-600'}),order(201,80,{shippedDate:'2026-11-05'}),order(202,120,{shippedDate:'2026-11-05'}),order(501,300,{shippedDate:'2026-11-05'}),order(601,400,{shippedDate:'2026-11-05',cartNumber:'cart-601'})],transactions:[{transactionId:'101',acquisition:'direct',device:'mobile'},{transactionId:'102',acquisition:'organic',device:'desktop'},{transactionId:'201',acquisition:'direct',device:'mobile'},{transactionId:'202',acquisition:'organic',device:'desktop'},{transactionId:'600',acquisition:'direct',device:'mobile'}],rozetkaIds:['500','501'],webRows:[],updatedAt:'2026-11-18T03:00:00Z'});

test('one shipment scope drives totals, channel chart, categories, brands and revenue drivers',()=>{
  const result=buildOverviewAttribution(fixture(),selection);
  assert.equal(result.sales.metrics.shippedRevenue,1500);
  // Creation date is outside the selected period: category/brand still use shipment date.
  assert.equal(result.sales.categories.reduce((sum,row)=>sum+row.revenue,0),1500);
  assert.equal(result.sales.brands.reduce((sum,row)=>sum+row.revenue,0),1500);
  assert.equal(periodChannelRows(result,selection).rows.reduce((sum,row)=>sum+row.total,0),1500);
  const drivers=overviewRevenueWaterfall(result,selection,'wow');
  assert.equal(drivers.start+drivers.steps.reduce((sum,step)=>sum+step.value,0),drivers.end);
  assert.ok(!drivers.steps.some(step=>step.key==='reconcile'));
  const filteredState={...selection,salesScope:'site',acquisition:'direct',device:'mobile'};
  const filtered=buildOverviewAttribution(fixture(),filteredState);
  filtered.chartSales=scopedSales(filtered.sales,filtered.salesChannels,filteredState.salesScope);
  assert.equal(overviewModel(filtered,filteredState).metrics[0].value,100);
  assert.equal(filtered.sales.metrics.shippedDocs,1);
  assert.equal(filtered.sales.categories[0].revenue,100);
  assert.equal(filtered.sales.brands[0].revenue,100);
  assert.equal(periodChannelRows(filtered,filteredState).rows.reduce((sum,row)=>sum+row.total,0),100);
  const html=renderBusinessOverview(filtered,filteredState);
  assert.match(html,/Бренди/);assert.doesNotMatch(html,/Різниця в обліку/);
  assert.equal(filtered.attribution.current.matchedDocs,2);
  assert.equal(filtered.attribution.current.docs,3);
  assert.doesNotMatch(JSON.stringify(filtered),/"(?:transactionId|webshopId|docsRef|user_pseudo_id|seller|number)"\s*:/);
});

test('ready-to-ship amount is a current ERP snapshot outside the chart series',()=>{
  const source=fixture();
  source.rows.push(
    order(701,2500,{state:'Відвантаження дозволено',shippedDate:null,createdDate:'2026-10-10',returnSum:200}),
    order(702,500,{state:'Відвантаження дозволено',shippedDate:null,cartNumber:'cart-702'}),
    order(703,5000,{state:'Відвантаження дозволено',shippedDate:null,cancelReason:'дубль замовлення'}),
  );
  const result=buildOverviewAttribution(source,selection);
  assert.deepEqual(result.readyToShip,{revenue:2800,docs:2,updatedAt:source.updatedAt});
  assert.equal(result.sales.metrics.shippedRevenue,1500);
  const markup=renderBusinessOverview(result,selection);
  assert.equal((markup.match(/Транзит/g)||[]).length,1);
  assert.match(markup,/data-bo-metric="revenue"[^]*?Транзит<\/span><b>\+2,8\sтис\.[^]*?<\/button>/);
});

test('lost website orders count by creation, include phone orders, and exclude marketplaces and reissues',()=>{
  const source = fixture();
  source.rows = [
    order(1,100,{createdDate:'2026-11-04',shippedDate:'2026-11-20'}),
    order(2,150,{createdDate:'2026-11-12',state:'Скасована',cancelReason:'Немає в наявності',webshopId:'',shippedDate:null}),
    order(3,0,{createdDate:'2026-11-13',state:'Скасована',shippedDate:null}),
    order(4,450,{createdDate:'2026-11-14',state:'Скасована',cancelReason:'Створення нового замовлення',shippedDate:null}),
    order(500,500,{createdDate:'2026-11-15',state:'Скасована',shippedDate:null}),
    order(6,500,{createdDate:'2026-11-16',state:'Скасована',cartNumber:'market-cart',shippedDate:null}),
    order(7,200,{createdDate:'2026-11-16',shippedDate:'2026-11-22'}),
    order(8,800,{createdDate:'2026-11-17',state:'Відвантаження дозволено',shippedDate:null}),
  ];
  const {orderLoss} = buildOverviewAttribution(source,selection);
  assert.equal(orderLoss.current.received,4);
  assert.equal(orderLoss.current.canceled,2);
  assert.equal(orderLoss.current.canceledWithAmount,1);
  assert.equal(orderLoss.current.average,1150/3);
  assert.equal(orderLoss.current.canceledAmount,150+1150/3);
  assert.equal(orderLoss.current.cancelShare,.5);
  assert.equal(orderLoss.current.estimated,true);
  assert.deepEqual(orderLoss.current.byReason.stock,{count:1,amount:150,estimated:false});
  assert.deepEqual(orderLoss.current.byReason.unknown,{count:1,amount:1150/3,estimated:true});
  assert.equal(Object.values(orderLoss.current.byReason).reduce((sum,reason)=>sum+reason.amount,0),orderLoss.current.canceledAmount);
  assert.equal(orderLoss.previous.received,1);
  assert.equal(buildOverviewAttribution(source,{...selection,salesScope:'marketplaces'}).orderLoss,undefined);
  const html = renderBusinessOverview(buildOverviewAttribution(source,selection),selection);
  assert.match(html,/Втрачені замовлення/);
  assert.doesNotMatch(html,/bo-order-loss-table/);
  assert.match(renderOrderLoss(orderLoss,'wow'),/Сайт AGROMAT/);
  const yoy = {...selection,compareMode:'yoy'};
  const yoyData = buildOverviewAttribution(source,yoy);
  assert.equal(yoyData.orderLoss.previous.available,false);
  const yoyHtml = renderOrderLoss(yoyData.orderLoss,'yoy');
  assert.match(yoyHtml,/Частка скасованих<\/th><td>0%<\/td><td>50%<\/td>/);
  assert.match(yoyHtml,/Наявність товару<\/th><td>0<small>0 ₴<\/small><\/td>/);
  assert.match(yoyHtml,/Нулі замість відсутніх даних/);
});

test('enabled margin uses scoped shipped net revenue and retains ERP zeros', () => {
  const source = fixture();
  source.rows = [
    order(101, 100, {margin:25, returnSum:20}),
    order(102, 120, {margin:0}),
    order(103, 300),
    order(104, 100, {margin:-10, shippedDate:'2026-11-13'}),
    order(600, 500, {margin:50, cartNumber:'marketplace'}),
    order(201, 80, {margin:10, shippedDate:'2026-11-05'}),
  ];
  source.margins = new WeakMap(source.rows.flatMap(row => row.margin == null ? [] : [[row.items[0], row.margin]]));
  const state = {...selection, salesScope:'site', chartMetric:'margin'};
  const defaultResult = buildOverviewAttribution(source, {...state, includeMargin:true});
  assert.ok(!('margin' in defaultResult));
  const result = buildOverviewAttribution(source, state, {includeMargin:true});
  assert.equal(result.margin.amount, 10);
  assert.equal(result.margin.percent, 10 / 300 * 100);
  assert.equal(result.margin.coveredDocs, 3);
  assert.equal(result.margin.docs, 4);
  assert.equal(result.margin.previous.amount, 8);
  result.chartSales = scopedSales(result.sales, result.salesChannels, state.salesScope);
  const history = selectedHistory(result.history, result.chartSales, result.range, result.comparisonRange, result.margin);
  const series = historySeries(history, 'margin', {range:result.range, interval:'day', comparisonMode:state.compareMode});
  assert.deepEqual(series.slice(0,3).map(({value,previous}) => [value,previous]), [[0,0],[20,8],[-10,0]]);
  assert.deepEqual(series.slice(0,3).map(row => [row.marginPercent,row.previousMarginPercent]), [[null,null],[10,10],[-10,null]]);
  const weeks = historySeries(history, 'margin', {range:result.range, interval:'week', comparisonMode:state.compareMode});
  assert.equal(weeks[0].marginPercent, 10 / 300 * 100);
  const html = renderBusinessOverview(result, state);
  assert.match(html, /data-bo-metric="margin" aria-pressed="true"/);
  assert.match(html, /data-bo-metric="margin" aria-pressed="true"><div class="bo-kpi-label"><span>Прибуток<\/span>/);
  assert.match(html, /<h2>Прибуток<\/h2>/);
  assert.match(html, /Прибуток, %<\/span><b>3,33%/);
  assert.match(html, /id="overview-sales-chart".*data-metric="margin"/);
  assert.match(html, /−6,67 п\. п\./);
});

test('line rates drive channel margins, mixed orders and the weighted comparison', () => {
  const source = fixture();
  const tile = item(100, '11'), plumbing = item(300, '22'), service = item(30, '18385');
  const site = order(101, 430, {items:[tile, plumbing, service], goodsCount:3, returnSum:50, returnGoodsCodes:['22'], returnRowSums:[50], margin:0});
  const roz = order(500, 200);
  const mono = order(600, 300, {cartNumber:'mono'});
  const prior = order(201, 80, {shippedDate:'2026-11-05'});
  source.rows = [site, roz, mono, prior, order(777, 400, {cancelReason:'Дубль замовлення'})];
  source.margins = new WeakMap([[tile,15],[plumbing,40],[service,99],[roz.items[0],10],[mono.items[0],0],[prior.items[0],20]]);
  const result = buildOverviewAttribution(source, selection, {includeMargin:true});
  const {site:shop, rozetka, monomarket} = result.margin.byChannel;
  assert.equal(shop.amount, 115);
  assert.equal(shop.percent, 115 / 350 * 100);
  assert.equal(rozetka.amount, 20);
  assert.equal(monomarket.amount, 0);
  assert.equal(result.margin.amount, 135);
  assert.equal(result.margin.percent, 135 / 850 * 100);
  assert.equal(result.margin.coveredLines, 4);
  assert.equal(result.margin.previous.byChannel.site.percent, 20);
  assert.equal(result.margin.previous.byChannel.rozetka.percent, null);
  const html = renderBusinessOverview(result, {...selection,chartMetric:'margin'});
  assert.match(html, /Прибуток і маржа за каналами продажу/);
  assert.match(html, /\+12,86 п\. п\./);
  assert.match(html, /−4,12 п\. п\./);
  assert.match(html, /Немає бази для порівняння/);
});

test('tile drill-down uses scoped net sales and the same dates last year even in WoW',()=>{
  const source = fixture();
  source.rows.push(
    order(110, 80, {items:[item(80,'1','Сантехніка','A')]}),
    order(111, 70, {items:[item(70,'2','Плитка','B')], returnSum:10, returnGoodsCodes:['2'], returnRowSums:[10]}),
    order(112, 30, {items:[item(30,'3','Хімія','C')], shippedDate:'2025-11-12'}),
    order(113, 20, {items:[item(20,'4','Плитка','D')], shippedDate:'2025-11-12'}),
  );
  const result = buildOverviewAttribution(source, {...selection, salesScope:'site'});
  const table = (label,dimension,shownLabels) => renderSalesBreakdown(result.breakdown,{label,dimension,measure:'revenue',shownLabels});
  const category = table('Плитка','categories');
  assert.match(category, /11\.11\.2025/);
  assert.match(category, /<th scope="row">A<\/th><td class="num">600<\/td><td class="num">0<\/td>/);
  assert.match(category, />B<\/th><td class="num">60<\/td>/);
  assert.match(category, />D<\/th><td class="num">0<\/td><td class="num">20<\/td>/);
  assert.doesNotMatch(category, /Хімія/);
  assert.match(table('A','brands'), />Сантехніка<\/th><td class="num">80<\/td>/);
  assert.doesNotMatch(table('Інші категорії','categories',['Плитка']), />Плитка<\/th>/);
  assert.match(table('Інші категорії','categories',['Плитка']), />Хімія<\/th>/);
  assert.match(table('Інші бренди','brands',['A']), />D<\/th>/);
  assert.doesNotMatch(table('Інші бренди','brands',['A']), />A<\/th>/);

  const slice = {...selection, salesScope:'site', acquisition:'direct', device:'mobile'};
  const filtered = buildOverviewAttribution({...source,previousYearTransactions:[
    {transactionId:'113', acquisition:'direct', device:'mobile'},
  ]},slice);
  assert.deepEqual(filtered.breakdown.pairs, [
    {category:'Плитка',brand:'A',current:{revenue:100,goods:1,missingQuantityLines:1}},
    {category:'Плитка',brand:'D',previous:{revenue:20,goods:1,missingQuantityLines:1}},
  ]);
  const missing = buildOverviewAttribution({...source,previousYearTransactions:null},slice);
  assert.match(renderSalesBreakdown(missing.breakdown,{label:'Плитка',dimension:'categories',measure:'goods'}), /Дані за торішній період тимчасово недоступні/);
});

test('quantity mode keeps ERP units separate for mixed brands, categories and marketplace channels', () => {
  const tile = item(100,'1','Плитка','A'), plumbing = item(200,'2','Сантехніка','A'), prior = item(70,'1','Плитка','A');
  const priorPlumbing = item(80,'2','Сантехніка','A');
  const source = {
    ...fixture(),
    rows: [order(500,100,{items:[tile]}),order(600,200,{items:[plumbing],cartNumber:'cart'}),
      order(501,70,{items:[prior],shippedDate:'2025-11-12'}),order(601,80,{items:[priorPlumbing],shippedDate:'2025-11-12',cartNumber:'cart'})],
    quantities: new WeakMap([[tile,{quantity:33.12,unit:'м²'}],[plumbing,{quantity:4,unit:'шт'}],[prior,{quantity:24,unit:'м²'}]]),
  };
  const state = {...selection,compareMode:'yoy',salesScope:'marketplaces',categoryMeasure:'goods',brandMeasure:'goods'};
  const result = buildOverviewAttribution(source, state);
  result.chartSales = scopedSales(result.sales, result.salesChannels, state.salesScope);
  assert.deepEqual({...result.chartSales.brands[0].quantities},{'м²':33.12,шт:4});
  assert.equal(result.chartSales.previous.brands[0].missingQuantityLines,1);
  const html = renderBusinessOverview(result,state);
  assert.match(html,/aria-label="Плитка: 33,12 м²; \+38%"/);
  assert.match(html,/aria-label="Сантехніка: 4 шт\.; Немає бази"/);
  assert.match(html,/aria-label="A: 33,12 м²; Немає бази"/);
  assert.match(html,/aria-label="A: 4 шт\.; Немає бази"/);
  const details = unit => renderSalesBreakdown(result.breakdown,{label:'A',dimension:'brands',measure:'goods',unit});
  assert.match(details('м²'), /Плитка<\/th><td class="num">33,12 м²<\/td><td class="num">24 м²<\/td>/);
  assert.doesNotMatch(details('м²'), /Сантехніка/);
  assert.match(details('шт'), /Сантехніка<\/th><td class="num">4 шт\.<\/td><td class="num">—<\/td>/);
  assert.doesNotMatch(details('шт'), /Плитка/);
});

test('MoM daily comparison does not count the last day of February four times',()=>{
 const days=(month,length)=>Array.from({length},(_,index)=>({date:`2026-${month}-${String(index+1).padStart(2,'0')}`,revenue:1,docs:1}));
 const range={from:'2026-03-01',to:'2026-03-31'};
 const rows=historySeries({range,sales:[{available:true,coverageFrom:'2026-02-01',days:[...days('02',28),...days('03',31)]}]},'revenue',{range,interval:'day',comparisonMode:'mom'});
 assert.equal(rows.reduce((sum,row)=>sum+(row.previous||0),0),28);
 assert.equal(rows.filter(row=>row.previous!=null).length,28);
 assert.deepEqual(rows.slice(-3).map(row=>row.previous),[null,null,null]);
});

test('weekly conversion uses exact period sessions, including a session crossing midnight',()=>{
 const range={from:'2026-11-11',to:'2026-11-12'};
 const history={range,web:{available:true,days:[{date:range.from,sessions:1,purchases:0},{date:range.to,sessions:1,purchases:1}],periods:[{key:range.from+':'+range.to,sessions:1,purchases:1}]}};
 assert.equal(historySeries(history,'conversion',{range,interval:'week'})[0].value,100);
});

test('exact IDs, duplicates, missing IDs and conflicting GA4 attributes never fabricate attribution',()=>{
  const source=fixture();
  source.transactions.push(source.transactions[0]);
  source.transactions.push({transactionId:'101',acquisition:'direct',device:'desktop'});
  const index=transactionIndex(source.transactions);
  assert.equal(index.get('101').acquisition,'direct');assert.equal(index.get('101').device,null);
  const filtered=buildOverviewAttribution(source,{...selection,salesScope:'site',acquisition:'direct',device:'mobile'});
  assert.equal(filtered.sales.metrics.shippedRevenue,0);
  assert.equal(filtered.attribution.current.ambiguousDocs,1);
  assert.equal(filtered.attribution.current.missingIdDocs,1);
  const all=buildOverviewAttribution(source,selection);
  assert.equal(all.sales.metrics.shippedRevenue,1500);
  source.rows.push(source.rows[0]);
  assert.throws(()=>buildOverviewAttribution(source,selection),/duplicate_erp_document/);
});

test('goods and returns reconcile to ERP without service revenue in category or brand totals',()=>{
  const source=fixture();
  source.rows=[order(101,350,{items:[item(100),item(200,'2','Сантехніка','B'),{...item(50,'18385'),name:'Транспортні послуги'}],goodsCount:3,returnSum:20,returnGoodsCodes:['2'],returnRowSums:[20]})];
  const result=buildOverviewAttribution(source,selection);
  assert.equal(result.sales.metrics.shippedRevenue,280);
  assert.equal(result.sales.categories.reduce((sum,row)=>sum+row.revenue,0),280);
  assert.equal(result.sales.brands.reduce((sum,row)=>sum+row.revenue,0),280);
});

test('marketplace traffic is unavailable rather than website data or a fabricated zero',()=>{
  const result=buildOverviewAttribution(fixture(),{...selection,salesScope:'marketplaces'});
  assert.equal(scopedSales(result.sales,result.salesChannels,'marketplaces').metrics.shippedRevenue,900);
  assert.equal(result.users.available,false);assert.equal(result.siteFunnel.available,false);
  assert.equal(result.history.users.periods.length,0);
  assert.throws(()=>validateSelection({...selection,salesScope:'marketplaces',device:'mobile'}),/marketplace_web_filter/);
});

test('comparison constraints use seven days, calendar month length and exact prior-year dates',()=>{
  assert.deepEqual(overviewDefaults('2026-11-18'),{from:'2026-11-01',to:'2026-11-17',compareMode:'yoy',salesScope:'all',acquisition:'all',device:'all'});
  assert.deepEqual(overviewDefaults('2026-12-01'),{from:'2026-11-01',to:'2026-11-30',compareMode:'yoy',salesScope:'all',acquisition:'all',device:'all'});
  assert.deepEqual(comparisonRange({from:'2026-11-13',to:'2026-11-15'},'wow'),{from:'2026-11-06',to:'2026-11-08'});
  assert.equal(comparisonAvailability({from:'2026-11-01',to:'2026-11-08'}).wow,false);
  assert.equal(validComparison({from:'2026-11-01',to:'2026-11-08'},'wow'),'mom');
  assert.equal(comparisonAvailability({from:'2026-11-01',to:'2026-12-01'}).mom,false);
  assert.deepEqual(comparisonRange({from:'2026-03-01',to:'2026-03-31'},'mom'),{from:'2026-02-01',to:'2026-02-28'});
  assert.deepEqual(comparisonRange({from:'2024-02-29',to:'2024-03-03'},'yoy'),{from:'2023-02-28',to:'2023-03-03'});
});

test('the overview cache follows the global dates and sales scope',()=>{
  const first=apiParams('overview',selection),second=apiParams('overview',{...selection,device:'mobile'});
  assert.equal(first.toString(),second.toString());
  assert.equal(second.get('device'),'all');
  assert.notEqual(first.toString(),apiParams('overview',{...selection,salesScope:'site'}).toString());
});

test('BigQuery only receives validated parameters',()=>{
  const query=overviewWebQuery('project','dataset',selection,comparisonRange(selection,'wow'));
  assert.equal(query.params.country,'Ukraine');assert.ok(query.query.includes('COUNT(DISTINCT IF(is_ukraine, user_pseudo_id, NULL))'));
  const tx=overviewTransactionsQuery('project','dataset',[selection],['101']);
  assert.deepEqual(tx.params.ids,['101']);assert.ok(!tx.query.includes("'101'"));
  assert.throws(()=>overviewWebQuery('project` UNION SELECT','dataset',selection,selection),/invalid_dataset/);
  assert.throws(()=>validateSelection({...selection,device:'tablet'}),/invalid_filter/);
});

test('complete linked data renders the funnel, charts and both maps together',()=>{
  const source=fixture();
  source.webRows=[{key:'current',acquisition:'all',device:'all',users:100,sessions:120,purchases:4,landing:90,view_item:60,cart:12,begin_checkout:6,purchase:7,data_from:'2026-11-11',data_through:'2026-11-17'},{key:'previous',acquisition:'all',device:'all',users:90,sessions:110,purchases:3,view_item:50,cart:10,begin_checkout:5,purchase:3,data_from:'2026-11-04',data_through:'2026-11-10'}];
  const data=buildOverviewAttribution(source,selection);data.chartSales=data.sales;
  assert.equal(data.siteFunnel.current.stages.find(stage=>stage.key==='landing').value,90);
  assert.equal(data.siteFunnel.current.stages.find(stage=>stage.key==='purchase').value,7);
  assert.equal(data.channels.purchases,4);
  const html=renderBusinessOverview(data,selection);
  assert.match(html,/11\.11\.2026 — 17\.11\.2026/);
  assert.match(html,/04\.11\.2026 — 10\.11\.2026/);
  assert.doesNotMatch(html,/Різниця в обліку|data-funnel-mode|data-category-period|data-waterfall-mode/);
});

test('combined acquisition and device selections change only the funnel in both periods',()=>{
  const source=fixture();
  const coverage={data_from:'2026-11-04',data_through:'2026-11-17'};
  source.webRows=['current','previous'].flatMap((key,index)=>[
    {key,acquisition:'all',device:'all',landing:90,purchase:9,users:100,sessions:120,purchases:4,...coverage},
    {key,acquisition:'all',device:'mobile',landing:50,purchase:5,...coverage},
    {key,acquisition:'direct',device:'mobile',landing:30-index*10,purchase:3-index,...coverage},
  ]);
  const filtered={...selection,acquisition:'direct',device:'mobile'};
  const data=buildOverviewAttribution(source,selection);
  data.chartSales=data.sales;
  const initial=renderBusinessOverview(data,selection), changed=renderBusinessOverview(data,filtered);
  assert.doesNotMatch(overviewControls(filtered),/Канали залучення|Пристрої|data-funnel-filter/);
  const matchFunnel=/<section id="bo-funnel"[\s\S]*?<\/section>/;
  assert.equal(initial.replace(matchFunnel,''),changed.replace(matchFunnel,''));
  const funnel=changed.match(matchFunnel)[0];
  assert.match(funnel,/data-funnel-filter="acquisition" data-value="direct" aria-pressed="true"/);
  assert.match(funnel,/data-funnel-filter="device" data-value="mobile" aria-pressed="true"/);
  assert.match(funnel,/aria-label="Старт: 30"/);
  assert.deepEqual(data.siteFunnel.slices['direct:mobile'].previous.stages.at(-1),{key:'purchase',value:2});
  const markets=renderBusinessOverview(buildOverviewAttribution(source,{...selection,salesScope:'marketplaces'}),
    {...filtered,salesScope:'marketplaces'}).match(matchFunnel)[0];
  assert.match(markets,/<fieldset class="bo-filter-group" disabled><legend>Канали залучення/);
  assert.match(markets,/GA4 сайту не вимірює трафік маркетплейсів/);
});

test('large transaction lookups partition dates while user counts retain whole-period distinctness',async()=>{
  const limit=()=>Object.assign(new Error('limit'),{errors:[{reason:'bytesBilledLimitExceeded'}]});
  const calls=[];
  const tx=await readBoundedTransactions(async query=>{calls.push(query.params);if(query.params.from1)throw limit();return [{transactionId:'101',acquisition:'direct',device:'mobile'}];},'project','dataset',[{from:'2026-11-01',to:'2026-11-17'},{from:'2025-11-01',to:'2025-11-17'}],['101']);
  assert.equal(calls.length,3);assert.equal(tx.length,2);assert.equal(transactionIndex(tx).size,1);
  let reads=0;
  const web=await readBoundedWeb(async query=>{if(++reads===1)throw limit();assert.equal(query.params.currentFrom,query.params.previousFrom);return [{key:'current',users:10},{key:'previous',users:10}];},'project','dataset',{from:'2026-11-01',to:'2026-11-17'},{from:'2025-11-01',to:'2025-11-17'});
  assert.deepEqual(web,[{key:'current',users:10},{key:'previous',users:10}]);
  await assert.rejects(()=>readBoundedTransactions(async()=>{throw Error('unavailable');},'project','dataset',[selection],['101']),/unavailable/);
});
