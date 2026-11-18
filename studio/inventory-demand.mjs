import fs from 'node:fs/promises';
import {gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {catalogSegment} from './catalog-health.mjs';
import {goodsOnlySalesRow, netSalesItems} from './erp-items.mjs';
import {addDays} from './public/overview-filters.mjs';

const unzip = promisify(gunzip);
const segments = ['Плитка', 'Сантехніка', 'Підлогові покриття', 'Будівельна хімія'];
const tileStockRule = {minRevenue:10_000, minViews:500, stockBelow:30};
const ignoredReasons = ['створення нового замовлення', 'дубль замовлення', 'фейкове замовлення', 'попередній прорахунок'];
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const readSnapshot = async file => JSON.parse(await unzip(await fs.readFile(file)));
const publicDays = days => days.map(({date,stock,views,docs}) => ({date,stock,views,docs}));

export function tileSalesStart(today) {
  const [year, month, day] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month-6, 0)).getUTCDate();
  return new Date(Date.UTC(year, month-7, Math.min(day,lastDay))).toISOString().slice(0,10);
}

export function buildTileStockWatch(items, revenueByCode) {
  const {minRevenue,minViews,stockBelow} = tileStockRule;
  const rows = items.filter(item => item.segment === 'Плитка' &&
    revenueByCode.get(item.code) >= minRevenue && item.views >= minViews)
    .map(({code,name,views,stock,days}) => ({code,name,views,stock,days:publicDays(days),
      revenue:revenueByCode.get(code), status:stock === null ? 'unknown' : stock < stockBelow ? 'low' : 'ok'}))
    .sort((a,b) => b.revenue-a.revenue || b.views-a.views || a.code.localeCompare(b.code));
  return {rows, alerts:rows.filter(row => row.status === 'low').length};
}

export function inventoryItemSignals(days, siteKnown) {
  const views = days.reduce((sum, d) => sum + (d.views ?? 0), 0);
  const absent = days.filter(d => d.stock !== null && d.stock < 1);
  const missedViews = absent.reduce((sum, d) => sum + (d.views ?? 0), 0);
  const inStock = days.filter(d => d.stock >= 1 && d.views !== null);
  const availableViews = inStock.reduce((sum, d) => sum + d.views, 0);
  const benchmark = siteKnown && inStock.length >= 7 && availableViews >= 30 &&
    inStock.filter(d => d.siteRevenue > 0).length >= 3;
  const opportunity = benchmark && missedViews > 0 ? Math.max(0,
    missedViews * inStock.reduce((sum, d) => sum + d.siteRevenue, 0) / availableViews -
    absent.reduce((sum, d) => sum + d.siteRevenue, 0)) : null;

  const recent = days.slice(-7);
  const current = recent.at(-1).stock;
  const confirmed = recent.filter(d => d.stock !== null);
  const recentViews = recent.reduce((sum, d) => sum + (d.views ?? 0), 0);
  const moves = recent.slice(1).flatMap((day, i) => day.stock !== null && recent[i].stock !== null
    ? [recent[i].stock - day.stock] : []);
  const rate = moves.length >= 4 && confirmed.length >= 5 ? median(moves) : 0;
  const cover = current >= 1 && rate > 0 ? current / rate : null;
  const risk = current === null ? 'unknown' : recentViews === 0 ? 'none' :
    current < 1 ? 'out' : cover !== null && cover <= 7 ? 'low' : 'none';
  return {views, missedViews, outDays:absent.length, opportunity, cover, stock:current, recentViews, risk};
}

async function readViews(from, to) {
  const source = [process.env.BIGQUERY_PROJECT_ID, process.env.BIGQUERY_DATASET_ID,
    process.env.BIGQUERY_PRODUCT_EVENTS_TABLE || 'items_detailed_events'];
  if (source.some(part => !/^[\w-]+$/.test(part || ''))) throw Error('invalid_dataset');
  const require = createRequire('/opt/agromat-content-analytics/package.json');
  const {BigQuery} = require(process.env.STUDIO_BIGQUERY_SDK || '/opt/agromat-content-analytics/node_modules/@google-cloud/bigquery');
  const [rows] = await new BigQuery({projectId:source[0]}).query({
    query: `SELECT CAST(event_date AS STRING) AS date,
      SAFE_CAST(NULLIF(TRIM(item_id), '') AS INT64) AS ref, COUNT(*) AS views
      FROM \`${source.join('.')}\`
      WHERE event_date BETWEEN DATE(@from) AND DATE(@to) AND event_name = 'view_item'
      GROUP BY 1, 2`,
    params:{from,to}, location:'EU', maximumBytesBilled:'20000000000', useQueryCache:true, jobTimeoutMs:60000,
  });
  return rows;
}

export async function readInventoryDemand(erp, rozetka) {
  const today = new Date().toLocaleDateString('sv-SE', {timeZone:'Europe/Kyiv'});
  const from = addDays(today, -30), to = addDays(today, -1);
  const salesFrom = tileSalesStart(today);
  const dates = Array.from({length:30}, (_, i) => addDays(from, i));
  const dayIndexes = new Map(dates.map((date, index) => [date,index]));
  const keys = new Map();
  let hasSalesHistory = false;
  for (const sale of erp.rows) {
    hasSalesHistory ||= Boolean(sale.shippedDate && sale.shippedDate <= salesFrom);
    for (const item of sale.items || []) {
      const code = String(item.code), date = sale.shippedDate || sale.createdDate || '';
      if (item.categoryKey && date >= (keys.get(code)?.date || '')) keys.set(code,{key:item.categoryKey,date});
    }
  }

  const dir = process.env.PRODUCT_SNAPSHOTS_DIR || '/var/lib/agromat-analytics/product-snapshots';
  const [catalog, snapshotFiles] = await Promise.all([
    readSnapshot(process.env.STUDIO_CATALOG_CACHE || '/var/cache/agromat-analytics/products-lite.json.gz'),
    fs.readdir(dir),
  ]);
  const known = new Set(snapshotFiles);
  const items = new Map(), refs = new Map(), ambiguous = new Set();
  for (const p of catalog.products) {
    if (p.deleted || !Number.isSafeInteger(p.goodsRef) || p.goodsRef <= 0) continue;
    const code = String(p.code), segment = catalogSegment(p,keys.get(code)?.key);
    if (!segments.includes(segment) || items.has(code)) continue;
    items.set(code,{code, name:p.name, segment, category:p.categoryName || segment,
      days:dates.map(date => ({date,stock:null,views:null,docs:0,siteRevenue:0}))});
    if (refs.has(p.goodsRef)) ambiguous.add(p.goodsRef);
    refs.set(p.goodsRef,code);
  }
  for (const ref of ambiguous) refs.delete(ref);

  const trafficTask = readViews(from,to).catch(() => null);
  const recorded = [];
  for (const [index,date] of dates.entries()) {
    if (!known.has(date+'.json.gz')) continue;
    const snapshot = await readSnapshot(dir+'/'+date+'.json.gz').catch(() => null);
    if (!Array.isArray(snapshot?.products)) continue;
    recorded.push(date);
    for (const p of snapshot.products) {
      const item = items.get(String(p.code));
      if (item && !p.deleted && Number.isFinite(p.stockQty)) item.days[index].stock = p.stockQty;
    }
  }
  const revenueByCode = new Map();
  const watchSalesAvailable = hasSalesHistory && Boolean(rozetka);
  for (const raw of erp.rows) {
    const i = dayIndexes.get(raw.shippedDate);
    if (i === undefined && (!watchSalesAvailable || !raw.shippedDate || raw.shippedDate < salesFrom || raw.shippedDate > to)) continue;
    const attributedToSite = rozetka && raw.webshopId && !raw.cartNumber && !rozetka.has(String(raw.webshopId));
    if ((i === undefined && !attributedToSite) || !String(raw.state).toLocaleLowerCase('uk').includes('повністю відвантаж') ||
      ignoredReasons.some(reason => String(raw.cancelReason || '').toLocaleLowerCase('uk').replace(/\s+/g,' ').includes(reason))) continue;
    const row = goodsOnlySalesRow(raw);
    if (!row) continue;
    const counted = new Set();
    for (const line of netSalesItems(row)) {
      const code = String(line.code), item = items.get(code);
      if (watchSalesAvailable && attributedToSite && item?.segment === 'Плитка') {
        revenueByCode.set(code, (revenueByCode.get(code) || 0)+line.revenue);
      }
      const day = item?.days[i];
      if (!day) continue;
      if (!counted.has(code)) day.docs++;
      if (attributedToSite) day.siteRevenue += line.revenue;
      counted.add(code);
    }
  }
  const traffic = await trafficTask;
  const trafficDays = new Set(traffic?.map(row => row.date));
  if (traffic) {
    for (const code of refs.values()) for (const day of items.get(code).days) if (trafficDays.has(day.date)) day.views=0;
    for (const row of traffic) {
      const item = items.get(refs.get(Number(row.ref))), i = dayIndexes.get(row.date);
      if (item && i !== undefined) item.days[i].views = Number(row.views);
    }
  }

  const all = [...items.values()].map(item => ({...item,...inventoryItemSignals(item.days, Boolean(rozetka))}));
  const tileWatch = {...tileStockRule, salesFrom, trafficDays:trafficDays.size,
    available:watchSalesAvailable && trafficDays.size > 0,
    notice:!watchSalesAvailable ? 'Дані про виторг сайту за 6 місяців недоступні.' :
      !trafficDays.size ? 'Дані про перегляди карток недоступні.' : null};
  if (tileWatch.available) Object.assign(tileWatch, buildTileStockWatch(all,revenueByCode));
  const sections = ['Усі сегменти',...segments].map(segment => {
    const candidates = all.filter(item => segment === 'Усі сегменти' || item.segment === segment);
    const impacted = candidates.filter(item => item.missedViews > 0).sort((a,b) => b.missedViews-a.missedViews);
    const risks = candidates.filter(item => ['out','low'].includes(item.risk))
      .sort((a,b) => Number(b.risk==='out')-Number(a.risk==='out') || b.recentViews-a.recentViews);
    const categories = new Map();
    for (const item of impacted) categories.set(item.category, (categories.get(item.category) || 0)+item.missedViews);
    const priced = impacted.filter(item => item.opportunity !== null);
    const demandLeaders = candidates.filter(item => item.views > 0).sort((a,b) => b.views-a.views);
    const rows = [...new Map([...impacted.slice(0,24),...risks.slice(0,24),...demandLeaders.slice(0,12)]
      .map(item => [item.code,item])).values()];
    return {segment, total:{outDays:candidates.reduce((sum,item)=>sum+item.outDays,0),
      missedViews:traffic ? impacted.reduce((sum,item)=>sum+item.missedViews,0) : null,
      atRisk:risks.length, outNow:risks.filter(item=>item.risk==='out').length,
      opportunity:priced.length ? priced.reduce((sum,item)=>sum+item.opportunity,0) : null, priced:priced.length},
      categories:[...categories].sort((a,b)=>b[1]-a[1]).slice(0,6),
      rows:rows.map(({days,...item})=>({...item, days:publicDays(days)}))};
  });
  const trafficAvailable = Boolean(traffic?.length);
  return {available:true,from,to,sourceDays:recorded.length,trafficAvailable,
    partial:!trafficAvailable || !rozetka || !recorded.length || !tileWatch.available, tileWatch,sections};
}
