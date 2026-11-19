import fs from 'node:fs/promises';
import {gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {readSnapshotProducts} from './inventory-snapshot-stream.mjs';
import {catalogSegment} from './catalog-health.mjs';
import {goodsOnlySalesRow,netSalesItems} from './erp-items.mjs';
import {addDays,rangeDays} from './public/overview-filters.mjs';
import {
  inventoryColumns,inventoryConfidence,inventoryPageSize,inventoryPrevious,inventoryStatuses,
  inventoryWatchColumns,inventoryWatchStatuses,
} from './public/inventory-demand-filters.mjs';
import {baselineDays,compareInventory,inventoryAnalysis,inventoryDetail,observation,stockRule} from './inventory-demand.mjs';

const unzip = promisify(gunzip);
const require = createRequire(process.env.STUDIO_SOURCE_PACKAGE || '/opt/agromat-content-analytics/package.json');
const labelCompare = (a,b) => a.localeCompare(b,'uk');
const ignoredReasons = ['створення нового замовлення','дубль замовлення','фейкове замовлення','попередній прорахунок'];
const toDate = value => String(value ?? '').slice(0,10);
const datePattern = /^\d{4}-\d\d-\d\d$/;
const kyivDate = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Kyiv'});
let sourceCache, analysisCache, viewCache;
let ga4Queries = [];

export function releaseInventoryDemandCache() {
  if (sourceCache) clearTimeout(sourceCache.eviction);
  sourceCache = null;
  analysisCache = null;
}

async function snapshot(file) {
  return JSON.parse(await unzip(await fs.readFile(file)));
}

async function files(dir) {
  return new Set((await fs.readdir(dir).catch(error=>{
    if (error.code==='ENOENT') return [];
    throw error;
  })).map(name=>name.replace(/\.json\.gz$/,'')).filter(name=>datePattern.test(name)));
}

const text = (value,fallback) => String(value ?? '').trim().slice(0,160) || fallback;
function dimensions(p) {
  const path = String(p.categoryPath ?? '').split(/[/›>]/).map(piece=>piece.trim()).filter(Boolean);
  const subcategory = text(p.categoryName || path.at(-1),'Без категорії');
  const category = path.some(name=>name.toLocaleLowerCase('uk')==='зарядні станції') ? 'Зарядні станції' :
    catalogSegment(p) || text(path[0],subcategory);
  return {category,subcategory,brand:text(p.brand,'Без бренду')};
}

function addSale(data,item,index,line,original,returnCodes,unallocated) {
  item.sales ??= new Map();
  let day = item.sales.get(index);
  if (!day) {
    day = {revenue:0,units:0,cost:0,coveredRevenue:0};
    item.sales.set(index,day);
  }
  day.revenue += line.revenue;
  if (Number.isFinite(line.qty) && line.qty>0) day.units += line.qty;
  // ERP exposes line cost for shipped quantities. Costs for returned quantities are absent.
  if (original?.ownCost>0 && line.revenue>0 && !unallocated && !returnCodes.has(String(line.code).trim())) {
    day.cost += original.ownCost;
    day.coveredRevenue += line.revenue;
  }
}

export function readInventorySales(data,erp,rozetka,reportEnd) {
  const ytd = new Map(), salesFrom = reportEnd.slice(0,4)+'-01-01';
  let first, last;
  const seen = new Set();
  for (const raw of erp?.rows || []) {
    const date = toDate(raw.shippedDate);
    if (!datePattern.test(date)) continue;
    if (!first || date<first) first=date;
    if (!last || date>last) last=date;
    const index = data.index.get(date);
    const watchDate = date>=salesFrom && date<=reportEnd;
    if (!rozetka || (index===undefined && !watchDate)) continue;
    const orderId = String(raw.webshopId || '').trim();
    const state = String(raw.state).toLocaleLowerCase('uk');
    const reason = String(raw.cancelReason || '').toLocaleLowerCase('uk').replace(/\s+/g,' ');
    if (!orderId || orderId==='0' || raw.cartNumber || rozetka.has(orderId) ||
      !state.includes('повністю відвантаж') || ignoredReasons.some(value=>reason.includes(value))) continue;
    const identity = String(raw.docsRef || raw.number || '').trim();
    if (identity && seen.has(identity)) continue;
    if (identity) seen.add(identity);
    const row = goodsOnlySalesRow(raw);
    if (!row) continue;
    const returnCodes = new Set(row.returnGoodsCodes.map(code=>String(code).trim()));
    const unattributedReturn = row.returnSum>0 && Math.abs(row.returnSum-row.returnRowSums.reduce((a,b)=>a+(b||0),0))>.01;
    for (const [lineIndex,line] of netSalesItems(row).entries()) {
      const code = String(line.code).trim();
      const item = data.items.get(code);
      if (!item || !Number.isFinite(line.revenue)) continue;
      if (watchDate && Object.hasOwn(stockRule.stockThresholds,item.category)) ytd.set(code,(ytd.get(code) ?? 0)+line.revenue);
      if (index!==undefined) addSale(data,item,index,line,row.items[lineIndex],returnCodes,unattributedReturn);
    }
  }
  if (rozetka && first && last) for (const [index,date] of data.dates.entries()) {
    data.salesCoverage[index] = Number(date>=first && date<=last);
  }
  return {ytd,salesFrom,watchSalesAvailable:Boolean(rozetka && first && first<=salesFrom && last>=reportEnd)};
}

async function recentViews(from,to) {
  const key = from+':'+to;
  if (viewCache?.key===key && viewCache.expires>Date.now()) return viewCache.rows;
  const names = [process.env.BIGQUERY_PROJECT_ID,process.env.BIGQUERY_DATASET_ID,
    process.env.BIGQUERY_PRODUCT_EVENTS_TABLE || 'items_detailed_events'];
  if (names.some(value=>!/^\w[\w-]*$/.test(value || ''))) return null;
  const now = Date.now();
  ga4Queries = ga4Queries.filter(time=>now-time<3600_000);
  if (ga4Queries.length>=12) return null;
  ga4Queries.push(now);
  const {BigQuery} = require(process.env.STUDIO_BIGQUERY_SDK || '@google-cloud/bigquery');
  const [rows] = await new BigQuery({projectId:names[0]}).query({
    query:'SELECT CAST(event_date AS STRING) AS date, SAFE_CAST(NULLIF(TRIM(item_id), \'\') AS INT64) AS ref, COUNT(*) AS views FROM `'+
      names.join('.')+'` WHERE event_date BETWEEN DATE(@from) AND DATE(@to) AND event_name = \'view_item\' GROUP BY 1, 2',
    params:{from,to},location:'EU',maximumBytesBilled:'20000000000',useQueryCache:true,jobTimeoutMs:60000,
  });
  viewCache = {key,rows,expires:Date.now()+600_000};
  return rows;
}

function stockWatch(data,sales,traffic,from,to) {
  const {ytd,salesFrom,watchSalesAvailable} = sales;
  const days = new Set(traffic?.map(row=>row.date));
  const recent = new Map();
  const refs = new Map(), ambiguous = new Set();
  for (const item of data.items.values()) {
    if (!item.ref) continue;
    if (refs.has(item.ref)) ambiguous.add(item.ref);
    refs.set(item.ref,item);
  }
  for (const {ref,views} of traffic || []) {
    const id = Number(ref), item = refs.get(id);
    if (!item || ambiguous.has(id)) continue;
    recent.set(item.code,(recent.get(item.code) ?? 0)+Number(views));
  }
  const available = watchSalesAvailable && days.size>0;
  const rows = [];
  if (available) for (const [code,revenue] of ytd) {
    const item = data.items.get(code), views = recent.get(code) ?? 0;
    const threshold = stockRule.stockThresholds[item.category];
    if (item.archived || revenue<stockRule.minRevenue || views<stockRule.minViews || threshold===undefined) continue;
    const stock = item.endStock ?? null;
    rows.push({code,revenue,views,stock,threshold,watchStatus:stock===null?'unknown':stock<=threshold?'low':'ok'});
  }
  return {...stockRule,available,rows,salesFrom,viewsFrom:from,to,weekCoverage:days.size,
    notice:!watchSalesAvailable?'Немає повного покриття виторгу сайту з початку року.':
      days.size<stockRule.viewDays?`Покриття GA4 · ${days.size} з ${stockRule.viewDays} днів.`:null};
}

async function aggregateInventorySales(data,readERP,rozetka,to,releaseERP) {
  try {
    const erp = await readERP().catch(()=>null);
    data.updatedAt = erp?.updatedAt ?? null;
    return readInventorySales(data,erp,rozetka,to);
  } finally {
    releaseERP();
  }
}

export async function loadInventoryData(selection,readERP,readOrigins,{dir, catalogue, readViews = recentViews, releaseERP = () => {}} = {}) {
  const {from,to} = selection, previous = inventoryPrevious(selection), first = addDays(previous.from,-baselineDays);
  const fromViews = addDays(to,1-stockRule.viewDays);
  const dates = Array.from({length:rangeDays({from:first,to})},(_,index)=>addDays(first,index));
  const index = new Map(dates.map((date,i)=>[date,i]));
  const weeks = dates.map(date=>Math.floor((Date.parse(date)+3*86400000)/604800000));
  dir ??= process.env.PRODUCT_SNAPSHOTS_DIR || '/var/lib/agromat-analytics/product-snapshots';
  catalogue ??= process.env.STUDIO_CATALOG_CACHE || '/var/cache/agromat-analytics/products-lite.json.gz';
  const compactDir = dir+'/availability-daily';
  const originTask = readOrigins().catch(()=>null);
  const viewsTask = readViews(fromViews,to).catch(()=>null);
  const [compact,full] = await Promise.all([files(compactDir),files(dir)]);
  const fullIndex = new Int16Array(dates.length).fill(-1);
  let fullCount = 0;
  for (const [i,date] of dates.entries()) if (full.has(date)) fullIndex[i]=fullCount++;
  const items = new Map(), byId = new Map(), ambiguous = new Set();
  function include(p) {
    const code = String(p.code ?? '').trim();
    if (!code || code==='0') return;
    const existing = items.get(code);
    if (existing) {
      if (existing.id!==p.id) ambiguous.add(code);
      return existing.id===p.id ? existing : undefined;
    }
    if (byId.has(p.id)) return;
    const item = {id:p.id,code,sku:p.sku || null,name:text(p.name,code),ref:Number(p.goodsRef) || null,
      firstSeen:toDate(p.firstSeenAt || p.createdAt),archived:Boolean(p.deleted),...dimensions(p),
      states:new Uint8Array(dates.length)};
    const losses = (p.statusHistory || []).filter(({from,to,at})=>
      (observation(from,false)&3)===1 && (observation(to,false)&3)===2 && Number.isFinite(Date.parse(at)));
    if (losses.length) item.lossEvents = losses.map(({at})=>kyivDate.format(new Date(at))).sort();
    items.set(code,item);
    byId.set(p.id,item);
    return item;
  }
  await readSnapshotProducts(catalogue,include);
  const data = {dates,index,weeks,items,fullIndex,statusCoverage:new Uint8Array(dates.length),
    salesCoverage:new Uint8Array(dates.length)};
  for (const [i,date] of dates.entries()) {
    const endpoint = date===to || date===previous.to;
    let fullRows = [];
    if (full.has(date)) {
      try {
        await readSnapshotProducts(dir+'/'+date+'.json.gz',p=>{
          const price = Number.isFinite(p.price) && p.price>0 && (!p.currency || /^(uah|грн\.?|₴)$/i.test(p.currency)) ? p.price : null;
          fullRows.push({id:p.id,state:observation(p.statusId,p.deleted,p.isOnSale),price,
            metadata:byId.has(p.id) ? null : p,
            dimensions:endpoint ? dimensions(p) : null,
            stock:date===to && !p.deleted && Number.isFinite(p.stockQty) ? p.stockQty : null});
        });
      } catch {
        fullRows=null;
      }
    }
    if (full.has(date) && fullRows) {
      data.statusCoverage[i]=1;
      for (const row of fullRows) {
        const item = byId.get(row.id) || include(row.metadata);
        if (!item) continue;
        item.states[i] = row.state;
        if (row.price!==null) {
          item.prices ??= new Float64Array(fullCount);
          item.prices[fullIndex[i]]=row.price;
        }
        if (row.dimensions) {
          item.dimensions ??= new Map();
          item.dimensions.set(i,row.dimensions);
        }
        if (row.stock!==null) item.endStock=row.stock;
      }
      continue;
    }
    // Older observations survive in the compact status archive.
    const compactDay = compact.has(date) ? await snapshot(compactDir+'/'+date+'.json.gz').catch(()=>null) : null;
    if (compactDay?.version===1 && Array.isArray(compactDay.products)) {
      data.statusCoverage[i]=1;
      for (const [id,category,brand,status,flags] of compactDay.products) {
        const item = byId.get(id);
        if (!item) continue;
        item.states[i] = observation(status,Boolean(flags&1),Boolean(flags&2));
        if (endpoint) {
          item.dimensions ??= new Map();
          item.dimensions.set(i,{category:item.category,subcategory:text(compactDay.categories?.[category]?.[1],item.subcategory),
            brand:text(compactDay.brands?.[brand]?.[1],item.brand)});
        }
      }
    }
  }
  for (const code of ambiguous) items.delete(code);
  // Discard long-retired items that had no orderable day in the loaded history.
  for (const item of items.values()) {
    item.archivedBeforeRange = item.archived && !item.states.some(value=>(value&3)===1);
  }
  // Finish reading the large JSON snapshots before deserializing the ERP cache.
  const sales = await aggregateInventorySales(data,readERP,await originTask,to,releaseERP);
  data.stockWatch = stockWatch(data,sales,await viewsTask,fromViews,to);
  return data;
}

function download(report,rows,selection) {
  const XLSX = require('xlsx');
  const columns = selection.view==='all' ? inventoryColumns : inventoryWatchColumns;
  const fields = Object.keys(columns);
  const headings = Object.values(columns);
  const body = rows.map(row=>fields.map(key=>{
    if (key==='status') return row.statusLabel ?? inventoryStatuses[row.status];
    if (key==='confidence') return inventoryConfidence[row.confidence] ?? null;
    if (key==='watchStatus') return inventoryWatchStatuses[row.watchStatus];
    return row[key];
  }));
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headings,...body],{dense:true});
  sheet['!autofilter'] = {ref:sheet['!ref']};
  sheet['!cols'] = headings.map((heading,i)=>({wch:i===1?48:Math.max(15,heading.length+2)}));
  XLSX.utils.book_append_sheet(book,sheet,'SKU');
  const filters = Object.entries(selection).filter(([key])=>!['export','page','sku'].includes(key));
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Період',report.range.from,report.range.to],
    ['Попередній період',report.previous.from,report.previous.to],['Днів зі статусом',report.coverage.current,report.coverage.days],
    ['Днів з ERP',report.coverage.sales,report.coverage.days],['Втрати',report.current.loss],
    ['Втрачена маржа',report.current.margin],[],...filters]),'Параметри');
  return {available:true,filename:`inventory-demand-${selection.from}-${selection.to}.xlsx`,
    file:XLSX.write(book,{bookType:'xlsx',type:'base64',compression:true})};
}

export async function readInventoryDemand(selection,readERP,readOrigins,releaseERP) {
  const {from,to,sku,sort,direction,page,priorityDate,export:exportFile,...filters} = selection;
  const key = from+':'+to;
  if (sourceCache?.key!==key || sourceCache.expires<=Date.now()) {
    releaseInventoryDemandCache();
    releaseERP?.();
    const value = await loadInventoryData(selection,readERP,readOrigins,{releaseERP});
    const hasCoverage = value.salesCoverage.some(Boolean) && value.statusCoverage.some(Boolean);
    const ttl = hasCoverage ? 600_000 : 60_000;
    const eviction = setTimeout(releaseInventoryDemandCache,ttl).unref();
    sourceCache = {key,value,expires:Date.now()+ttl,eviction};
  }
  const data = sourceCache.value;
  if (sku) {
    const item = data.items.get(sku);
    return {available:true,detail:item ? inventoryDetail(data,item,{from,to}) : null};
  }
  const filteredKey = JSON.stringify(filters);
  if (analysisCache?.key!==filteredKey) {
    analysisCache = {key:filteredKey,result:inventoryAnalysis(data,selection)};
  }
  const {table,priorityFor,...report} = analysisCache.result;
  if (priorityDate) return {available:true,priority:priorityFor(priorityDate)};
  const rows = table.toSorted((a,b)=>selection.view==='all' || sort!=='loss'
    ? compareInventory(a,b,selection) : b.revenue-a.revenue || b.views-a.views || labelCompare(a.code,b.code));
  if (exportFile==='1') return download(report,rows,selection);
  const pages = Math.max(1,Math.ceil(rows.length/inventoryPageSize));
  const activePage = Math.min(Number(page),pages);
  const {coverage} = report;
  const partial = [coverage.current,coverage.previous,coverage.sales,coverage.previousSales].some(days=>days<coverage.days);
  return {available:true,...report,partial,priority:priorityFor(to),
    table:{total:rows.length,page:activePage,pages,rows:rows.slice((activePage-1)*inventoryPageSize,activePage*inventoryPageSize)}};
}
