import {goodsOnlySalesRow, netSalesItems} from './erp-items.mjs';
import {addDays, rangeDays} from './public/overview-filters.mjs';
import {contentBaseline, contentGroups, minimumContentSample} from './public/content-conversion-filters.mjs';

const fields = ['sessions','views','atc','purchaseSessions','purchases','incomplete','revenue'];
const queryFields = ['sessions','views','atc','purchase_sessions','purchases','incomplete_revenue','revenue'];
const empty = () => Object.fromEntries(fields.map(key => [key,0]));
const ratio = (part, whole) => whole > 0 ? part / whole * 100 : null;
const delta = (a,b) => a == null || b == null ? null : a-b;
const within = (day,{from,to}) => day >= from && day <= to;
const days = (range) => Array.from({length:rangeDays(range)},(_,i) => addDays(range.from,i));
const validScore = score => Number.isFinite(score) && score >= 0 && score <= 100;
const asScore = score => validScore(score) ? score : null;
const collator = new Intl.Collator('uk', {numeric:true});
const distinct = values => [...new Set(values.filter(Boolean))].sort(collator.compare);

export function contentCatalogue(products, attributes, promotions) {
  const visible = new Map();
  for (const p of products) if (!p.deleted && p.code && !visible.has(p.id)) visible.set(p.id,p);
  const codeCounts = new Map(), refCounts = new Map();
  for (const p of visible.values()) {
    const code = String(p.code);
    codeCounts.set(code,(codeCounts.get(code) || 0)+1);
    if (Number.isSafeInteger(p.goodsRef) && p.goodsRef > 0) refCounts.set(p.goodsRef,(refCounts.get(p.goodsRef) || 0)+1);
  }
  const refs = new Map();
  const catalogue = [];
  for (const p of visible.values()) {
    const code = String(p.code);
    if (codeCounts.get(code) !== 1) continue;
    const path = (p.categoryPath || p.categoryName || '').split(/[/›>]/).map(part => part.trim()).filter(Boolean);
    const category = p.categoryName || path.at(-1) || '';
    const price = p.currency === 'UAH' && Number.isFinite(p.price) && p.price > 0 ? p.price : null;
    const required = attributes?.required[p.categoryId] || [];
    const filled = required.length ? attributes.present.get(p.id) : null;
    const missing = filled ? required.filter(id => !filled.has(id)).map(id => attributes.names.get(id) || String(id)) : null;
    const stock = !Number.isFinite(p.stockQty) ? 'unknown' : p.stockQty >= 1 ? 'in' : 'out';
    const promo = !promotions ? 'unknown' : promotions.has(code) ? 'yes' : 'no';
    const product = {
      code, name:p.name || code, brand:p.brand || '', sku:p.sku || null, root:path[0] || category,
      category, categoryId:p.categoryId, price,
      priceBand:price === null ? 'unknown' : price < 1000 ? 'low' : price < 5000 ? 'middle' : 'high',
      stock, promo, photos:Number.isInteger(p.imagesCount) ? p.imagesCount : null,
      reviews:Number.isInteger(p.reviewsCount) ? p.reviewsCount : null,
      attributes:missing ? ratio(required.length-missing.length,required.length) : null, missing,
    };
    catalogue.push(product);
    if (refCounts.get(p.goodsRef) === 1) refs.set(p.goodsRef,code);
  }
  return {catalogue,refs,ambiguous:visible.size-catalogue.length,catalogueCount:visible.size};
}

export function contentBucket(table,value) {
  if (!Number.isFinite(value) || value < 0) return -1;
  if (table === 'score') return Math.max(0,Math.ceil(value/20)-1);
  if (table === 'photos') return value < 3 ? value : value < 5 ? 3 : value < 8 ? 4 : 5;
  if (table === 'reviews') return value < 2 ? value : value < 4 ? 2 : 3;
  if (table === 'attributes') return value === 100 ? 4 : Math.min(3,Math.max(0,Math.ceil(value/25)-1));
  return -1;
}

export function compactContentTraffic() {
  const columns = fields.length+1;
  const chunkLength = columns*2048;
  const coverage = new Set(), periods = {current:new Map(),previous:new Map()};
  return {
    coverage, periods,
    add(rows) {
      for (const row of rows) {
        const day = row.day.replace(/^(\d{4})(\d\d)(\d\d)$/,'$1-$2-$3');
        if (row.period === 'coverage') {
          coverage.add(day);
          continue;
        }
        const byDay = periods[row.period];
        let entry = byDay.get(day);
        if (!entry) byDay.set(day,entry={blocks:[],used:chunkLength});
        if (entry.used === chunkLength) {
          entry.blocks.push(new Float64Array(chunkLength));
          entry.used = 0;
        }
        const block = entry.blocks.at(-1);
        block[entry.used++] = Number(row.ref) || 0;
        for (const field of queryFields) block[entry.used++] = Number(row[field]) || 0;
      }
    },
    visit(period, day, fn) {
      const entry = periods[period].get(day);
      if (!entry) return;
      for (const [index,block] of entry.blocks.entries()) {
        const count = index === entry.blocks.length-1 ? entry.used : block.length;
        for (let i=0; i<count; i+=columns) fn(block[i],block,i+1);
      }
    },
  };
}

function addBlock(target, block, i) {
  for (const [index,field] of fields.entries()) target[field] += block[i+index];
}

function addMetrics(target, metrics) {
  for (const field of fields) target[field] += metrics[field];
}

function present(metrics, available) {
  if (!available) return {...Object.fromEntries(fields.map(key=>[key,null])),atcRate:null,purchaseRate:null};
  return {...metrics, atcRate:ratio(metrics.atc,metrics.sessions), purchaseRate:ratio(metrics.purchaseSessions,metrics.sessions),
    revenue:metrics.incomplete ? null : metrics.revenue};
}

function scoreOverview(products,snapshot) {
  let count=0, sum=0, high=0;
  if (snapshot) for (const {code} of products) {
    const score = snapshot.scores[code];
    if (!validScore(score)) continue;
    count++; sum+=score;
    if (score >= 80) high++;
  }
  return {date:snapshot?.date ?? null, count, high:count ? high : null, mean:count ? sum/count : null, share:ratio(high,count)};
}

function matches(product, selection) {
  const {root,category,brand,price,promo,search} = selection;
  return (!root || product.root === root) && (!category || product.category === category) &&
    (!brand || product.brand === brand) && (price === 'all' || price === product.priceBand) &&
    (promo === 'all' || promo === product.promo) &&
    (!search || [product.code,product.sku,product.name].some(part => part?.toLocaleLowerCase('uk').includes(search)));
}

function peerKey(p) {
  return p.categoryId && p.brand && p.priceBand !== 'unknown' && p.stock !== 'unknown' && p.promo !== 'unknown'
    ? JSON.stringify([p.categoryId,p.brand,p.priceBand,p.stock,p.promo]) : null;
}

function median(values) {
  const sorted = values.sort((a,b) => a-b);
  return (sorted[Math.floor((sorted.length-1)/2)] + sorted[Math.floor(sorted.length/2)]) / 2;
}

export function contentOpportunities(products) {
  const peers = new Map();
  for (const item of products) {
    const key = peerKey(item);
    if (!key || item.score === null || item.sessions < minimumContentSample) continue;
    if (!peers.has(key)) peers.set(key,[]);
    peers.get(key).push(item);
  }
  const rows = [];
  for (const item of products) {
    if (!(item.score < 80) || item.score === null || item.sessions < minimumContentSample || item.purchaseRate === null) continue;
    const missing = [
      ...(item.photos !== null && item.photos < 6 ? [`Фото: ${item.photos} з 6`] : []),
      ...(item.missing?.length ? [`Характеристики: ${item.missing.join(', ')}`] : []),
      ...(item.reviews === 0 ? ['Відгуків немає'] : []),
    ];
    if (!missing.length) continue;
    const candidates = (peers.get(peerKey(item)) || []).filter(other => other.code !== item.code && other.score >= 80);
    if (candidates.length < 5) continue;
    const target = median(candidates.map(other=>other.purchaseRate));
    const gap = target-item.purchaseRate;
    if (gap <= 0) continue;
    const validPurchases = candidates.filter(other => other.purchases > 0 && other.revenue !== null && other.revenue > 0);
    const purchases = validPurchases.reduce((sum,other)=>sum+other.purchases,0);
    const averageOrder = purchases ? validPurchases.reduce((sum,other)=>sum+other.revenue,0)/purchases : null;
    const potentialOrders = item.sessions*gap/100;
    rows.push({...item, target, gap, peers:candidates.length, missing, potentialOrders,
      potentialRevenue:averageOrder === null ? null : potentialOrders*averageOrder});
  }
  return rows;
}

export function contentShipments(source, range, fromCatalogue) {
  if (!source) return null;
  const seen = new Set(), byCode = new Map();
  let earliest = '9999-12-31';
  for (const raw of source.rows) {
    const date = raw.shippedDate;
    if (!date || !String(raw.state).toLocaleLowerCase('uk').includes('повністю відвантаж')) continue;
    if (date < earliest) earliest = date;
    if (!within(date,range) || /створення нового замовлення|дубль замовлення|фейкове замовлення|попередній прорахунок/i.test(raw.cancelReason || '')) continue;
    if (!raw.docsRef || seen.has(raw.docsRef)) continue;
    seen.add(raw.docsRef);
    const row = goodsOnlySalesRow(raw);
    if (!row) continue;
    const counted = new Set();
    for (const line of netSalesItems(row)) {
      const code = String(line.code);
      if (fromCatalogue && !fromCatalogue.has(code)) continue;
      const item = byCode.get(code) || {revenue:0,orders:0};
      item.revenue += line.revenue;
      if (!counted.has(code)) item.orders++;
      counted.add(code);
      byCode.set(code,item);
    }
  }
  return earliest <= range.from ? byCode : null;
}

function compareRows(a,b,key,direction,secondary) {
  if (key === 'name' || key === 'date') return direction * collator.compare(a[key],b[key]) || collator.compare(a.code,b.code);
  if (a[key] == null || b[key] == null) return Number(a[key] == null)-Number(b[key] == null) || collator.compare(a.code,b.code);
  return direction * (a[key]-b[key] || (secondary ? a[secondary]-b[secondary] : 0)) || collator.compare(a.code,b.code);
}

export function contentTable(report, selection) {
  const group = selection.table;
  const component = ['photos','attributes','reviews'].includes(group);
  const bucketOf = row => component ? contentBucket(group,row[group]) : row.bucket;
  let rows = report.tables[group] || report.tables.score;
  if (selection.bucket !== '') rows = rows.filter(row => bucketOf(row) === Number(selection.bucket));
  const secondary = group === 'improved' && selection.sort === 'change' ? 'atcChange' : null;
  rows = [...rows].sort((a,b) => compareRows(a,b,selection.sort,selection.direction === 'asc' ? 1 : -1,secondary));
  const size = 25, total = rows.length, page = Math.min(selection.page,Math.max(1,Math.ceil(total/size)));
  const selected = selection.export === '1' ? rows : rows.slice((page-1)*size,page*size);
  return {rows:component ? selected.map(row=>({...row,bucket:bucketOf(row)})) : selected,total,size,page};
}

function historyRows(changes, meta, windows, scorePresence, fullScoreDates, traffic, range) {
  const history = [], improved = [];
  let increases = 0, comparable = 0;
  const byDate = new Map(), peers = new Map();
  for (const [code,list] of changes) {
    const latest = list.at(-1);
    if (!byDate.has(latest.date)) byDate.set(latest.date,[]);
    byDate.get(latest.date).push({...latest,code});
  }
  for (const item of meta.values()) {
    const key = peerKey(item);
    if (!key) continue;
    if (!peers.has(key)) peers.set(key,[]);
    peers.get(key).push(item.code);
  }
  for (const [date,items] of byDate) {
    const comparison = windowDays => {
      const beforeRange = {from:addDays(date,-windowDays),to:addDays(date,-1)};
      const afterRange = {from:addDays(date,1),to:addDays(date,windowDays)};
      const window = [...days(beforeRange), date, ...days(afterRange)];
      if (!within(beforeRange.from,range) || !within(afterRange.to,range) ||
          !window.every(day=>fullScoreDates.has(day) && traffic?.coverage.has(day))) return null;
      const start = rangeDays({from:range.from,to:beforeRange.from})-1;
      const observed = code => scorePresence.get(code).subarray(start,start+window.length).every(value=>value === 1);
      const changed = (code, except) => changes.get(code)?.some(event=>
        event.date !== except && within(event.date,{from:beforeRange.from,to:afterRange.to}));
      let data;
      const read = () => data ??= windows(beforeRange,afterRange);
      return {beforeRange,afterRange,windowDays,read,observed,changed};
    };
    const weekly = comparison(7);
    const shorterWindows = new Map();
    const controls = new Map();
    const benchmark = key => {
      if (!key || !weekly) return null;
      if (controls.has(key)) return controls.get(key);
      const [beforeData,afterData] = weekly.read();
      const reference = [empty(),empty()];
      let count = 0;
      for (const code of peers.get(key) || []) {
        if (!weekly.observed(code) || weekly.changed(code)) continue;
        const first = beforeData.get(code), second = afterData.get(code);
        if (!(first?.sessions > 0 && second?.sessions > 0)) continue;
        count++;
        addMetrics(reference[0],first);
        addMetrics(reference[1],second);
      }
      const result = count >= 5 && reference.every(period=>period.sessions >= minimumContentSample)
        ? {count,change:ratio(reference[1].purchaseSessions,reference[1].sessions)-ratio(reference[0].purchaseSessions,reference[0].sessions)}
        : null;
      controls.set(key,result);
      return result;
    };
    const measure = (window, code) => {
      if (!window || !window.observed(code) || window.changed(code,date)) return null;
      const [beforeData,afterData] = window.read();
      const before = present(beforeData.get(code) || empty(),true);
      const after = present(afterData.get(code) || empty(),true);
      return {before,after,change:delta(after.purchaseRate,before.purchaseRate),
        atcChange:delta(after.atcRate,before.atcRate),beforeRange:window.beforeRange,
        afterRange:window.afterRange,windowDays:window.windowDays};
    };
    const longestShorter = code => {
      // Choose the longest complete window before checking conversion.
      for (let windowDays=6;windowDays>=1;windowDays--) {
        if (!shorterWindows.has(windowDays)) shorterWindows.set(windowDays,comparison(windowDays));
        const measured = measure(shorterWindows.get(windowDays),code);
        if (measured) return measured;
      }
      return null;
    };
    for (const item of items) {
      const product = meta.get(item.code);
      const measured = measure(weekly,item.code);
      const control = measured?.before.sessions >= minimumContentSample && measured.after.sessions >= minimumContentSample
        ? benchmark(peerKey(product)) : null;
      history.push({...product,...item,before:measured?.before ?? null,after:measured?.after ?? null,
        change:measured?.change ?? null,control,adjusted:control ? measured.change-control.change : null});
      if (item.score <= item.scoreBefore) continue;
      increases++;
      const result = measured || longestShorter(item.code);
      if (result?.change == null || result.atcChange == null) continue;
      comparable++;
      if (result.change !== 0 || result.atcChange !== 0) improved.push({...product,...item,...result});
    }
  }
  return {history,improved,improvements:{increases,comparable,results:improved.length}};
}

export async function buildContentReport({catalog, traffic, readScore, scoreDates, catalogDate, promoDate, shipments}, selection) {
  const range = {from:selection.from,to:selection.to}, previous = contentBaseline(selection);
  async function close(period) {
    for (const date of scoreDates.filter(date=>within(date,period)).toReversed()) {
      const scores = await readScore(date);
      if (scores) return {date,scores};
    }
    return null;
  }
  const [currentScore, priorScore] = await Promise.all([close(range),close(previous)]);
  const {catalogue,refs} = catalog;
  const inStock = catalogue.filter(product=>product.stock === 'in');
  const scoreFilter = selection.minScore !== 0 || selection.maxScore !== 100;
  const products = inStock.filter(p=>matches(p,{...selection,search:selection.search.toLocaleLowerCase('uk')}) &&
    (!scoreFilter || (validScore(currentScore?.scores[p.code]) &&
      currentScore.scores[p.code] >= selection.minScore && currentScore.scores[p.code] <= selection.maxScore)));
  const meta = new Map(products.map(p=>[p.code,p]));
  const matchedCodes = new Set(refs.values());
  const totals = empty(), priorTotals = empty(), byCode = new Map(), changes = new Map(), scoreRows = new Map();
  const grouped = Object.fromEntries(Object.entries(contentGroups).map(([key,labels])=>[key,labels.map(label=>({label,codes:new Set(),metrics:empty()}))]));
  const daily = [];
  const scorePresence = new Map(products.map(p=>[p.code,new Uint8Array(rangeDays(range))]));
  const scoreDays = new Set();
  let previousDay = null, previousSnapshot = null, unmapped = 0, unscored = 0, coveredCurrent = 0;
  for (const [index,date] of days(range).entries()) {
    const scores = scoreDates.includes(date) ? await readScore(date) : null;
    const covered = traffic?.coverage.has(date);
    if (scores) {
      scoreDays.add(date);
      for (const {code} of products) if (validScore(scores[code])) scorePresence.get(code)[index] = 1;
    }
    if (covered) coveredCurrent++;
    const metrics = empty();
    if (scores && previousSnapshot && previousDay === addDays(date,-1)) for (const {code} of products) {
      const before = previousSnapshot[code], after = scores[code];
      if (!validScore(before) || !validScore(after) || before === after) continue;
      if (!changes.has(code)) changes.set(code,[]);
      changes.get(code).push({date,scoreBefore:before,score:after});
    }
    previousSnapshot = scores;
    previousDay = date;
    traffic?.visit('current',date,(ref,block,offset) => {
      const code = refs.get(ref);
      if (!code) { unmapped+=block[offset]; return; }
      if (!meta.has(code)) return;
      if (!byCode.has(code)) byCode.set(code,empty());
      addBlock(byCode.get(code),block,offset);
      addBlock(totals,block,offset);
      addBlock(metrics,block,offset);
      const score = asScore(scores?.[code]);
      const bucket = contentBucket('score',score);
      if (bucket < 0) { unscored+=block[offset]; return; }
      const group = grouped.score[bucket];
      group.codes.add(code);
      addBlock(group.metrics,block,offset);
      const key = code+':'+bucket;
      if (!scoreRows.has(key)) scoreRows.set(key,{code,bucket,scoreSum:0,scoreUnits:0,metrics:empty()});
      const row = scoreRows.get(key);
      row.scoreSum+=score*block[offset]; row.scoreUnits+=block[offset];
      addBlock(row.metrics,block,offset);
    });
    daily.push({date,score:scoreOverview(products,scores ? {date,scores} : null).mean,
      ...present(metrics,Boolean(covered))});
  }
  const coveredPrevious = days(previous).filter(date=>traffic?.coverage.has(date)).length;
  traffic?.visit('previous','',(ref,block,offset)=>{
    if (meta.has(refs.get(ref))) addBlock(priorTotals,block,offset);
  });
  const shipped = shipments?.byCode;
  const catalogRows = products.map(p=>({...p, score:asScore(currentScore?.scores[p.code]),
    ...present(byCode.get(p.code) || empty(),coveredCurrent > 0 && matchedCodes.has(p.code)),
    shipmentRevenue:shipped ? shipped.get(p.code)?.revenue ?? 0 : null,
    shipmentOrders:shipped ? shipped.get(p.code)?.orders ?? 0 : null,
  }));
  const detail = new Map(catalogRows.map(row=>[row.code,row]));
  const tables = {
    score:[...scoreRows.values()].map(row=>({...detail.get(row.code), bucket:row.bucket, score:row.scoreSum/row.scoreUnits,
      ...present(row.metrics,true), shipmentRevenue:null,shipmentOrders:null})),
  };
  for (const key of ['photos','attributes','reviews']) {
    tables[key] = [];
    for (const row of catalogRows) {
      const bucket = contentBucket(key,row[key]);
      if (bucket < 0) continue;
      const group = grouped[key][bucket];
      group.codes.add(row.code);
      if (byCode.has(row.code)) addMetrics(group.metrics,byCode.get(row.code));
      tables[key].push(row);
    }
  }
  function windowMetrics(before,after) {
    return [before,after].map(period=>{
      const result = new Map();
      for (const date of days(period)) traffic.visit('current',date,(ref,block,offset)=>{
        const code = refs.get(ref);
        if (!meta.has(code)) return;
        if (!result.has(code)) result.set(code,empty());
        addBlock(result.get(code),block,offset);
      });
      return result;
    });
  }
  const comparisons = historyRows(changes,detail,windowMetrics,scorePresence,scoreDays,traffic,range);
  tables.history = comparisons.history;
  tables.improved = comparisons.improved;
  const complete = coveredCurrent === rangeDays(range) && coveredPrevious === rangeDays(previous);
  const current = {...scoreOverview(products,currentScore), ...present(totals,coveredCurrent>0)};
  const baseline = {...scoreOverview(products,priorScore), ...present(priorTotals,coveredPrevious>0)};
  tables.opportunity = coveredCurrent === rangeDays(range) ? contentOpportunities(catalogRows) : [];
  return {
    available:true, partial:!complete || !currentScore, range, previous, catalogDate, promoDate,
    current, baseline, complete, coveredCurrent, coveredPrevious, scoreDays:scoreDays.size, daily, tables,
    products:products.length, unmatched:unmapped, unscored, ambiguous:catalog.ambiguous,
    lastWebDate:[...(traffic?.coverage || [])].filter(date=>within(date,range)).sort().at(-1) ?? null,
    erpDate:shipped ? shipments.updatedAt : null,
    erpRevenue:shipped ? catalogRows.reduce((sum,item)=>sum+item.shipmentRevenue,0) : null,
    historyExposures:tables.history.filter(row=>row.before && row.after).length,
    improvements:comparisons.improvements,
    groups:Object.fromEntries(Object.entries(grouped).map(([key,rows])=>[key,rows.map(row=>({
      label:row.label, skus:row.codes.size,...present(row.metrics,coveredCurrent > 0 && (key !== 'score' || scoreDays.size > 0)),
    }))])),
    options:{roots:distinct(inStock.map(p=>p.root)),categories:distinct(inStock.filter(p=>!selection.root || p.root === selection.root).map(p=>p.category)),
      brands:distinct(inStock.filter(p=>(!selection.root || p.root === selection.root) && (!selection.category || p.category === selection.category)).map(p=>p.brand))},
  };
}
