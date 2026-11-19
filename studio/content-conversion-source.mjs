import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {buildContentReport, compactContentTraffic, contentCatalogue, contentTable} from './content-conversion.mjs';
import {readContentFunnel} from './content-conversion-query.mjs';
import {contentBaseline} from './public/content-conversion-filters.mjs';

const unzip = promisify(gunzip);
const require = createRequire('/opt/agromat-content-analytics/package.json');
const day = date => new Date(date).toLocaleDateString('sv-SE',{timeZone:'Europe/Kyiv'});
const readGzip = async file => JSON.parse(await unzip(await fs.readFile(file)));
const readJson = async file => JSON.parse(await fs.readFile(file,'utf8'));

let trafficCache, reportCache;
let queried = [];

async function readAttributes(syncedAt) {
  let client;
  try {
    if (process.env.REDIS_URL) {
      const Redis = require('ioredis');
      client = new Redis(process.env.REDIS_URL, {lazyConnect:true, connectTimeout:3500, commandTimeout:6000, retryStrategy:()=>null});
    } else {
      const {Redis} = require('@upstash/redis');
      client = new Redis({url:process.env.UPSTASH_REDIS_REST_URL,token:process.env.UPSTASH_REDIS_REST_TOKEN,
        automaticDeserialization:false,signal:()=>AbortSignal.timeout(8000)});
    }
    const [requiredRaw,indexRaw] = await client.mget('products:required_attrs','products:attribute-index:v1');
    if (!requiredRaw || !indexRaw) return null;
    const required = JSON.parse(requiredRaw);
    const index = JSON.parse(indexRaw);
    if (index.syncedAt !== syncedAt || !Array.isArray(index.entries)) return null;
    const present = new Map(), names = new Map();
    for (const [id,attrs] of index.entries) {
      present.set(id,new Set(attrs.map(attr=>attr.id)));
      for (const attr of attrs) names.set(attr.id,attr.name);
    }
    return {required,present,names};
  } finally {
    client?.disconnect?.();
  }
}

async function readPromotionCodes(directory, catalogueDay) {
  const file = path.join(directory,catalogueDay+'.json.gz');
  const snapshot = await readGzip(file);
  if (!Array.isArray(snapshot?.promotions)) return null;
  const codes = new Set();
  for (const promo of snapshot.promotions) {
    if (!promo.active || promo.has_related || !Array.isArray(promo.products)) continue;
    for (const product of promo.products) {
      if (product.promotion_idinc === promo.idinc) codes.add(String(product.code));
    }
  }
  return {codes,date:catalogueDay};
}

async function readCatalogue() {
  const snapshotFile = process.env.STUDIO_CATALOG_CACHE || '/var/cache/agromat-analytics/products-lite.json.gz';
  const snapshot = await readGzip(snapshotFile);
  if (!Array.isArray(snapshot.products) || !Number.isFinite(Date.parse(snapshot.syncedAt))) throw Error('catalogue_unavailable');
  const inventory = process.env.PRODUCT_SNAPSHOTS_DIR || '/var/lib/agromat-analytics/product-snapshots';
  const scoreDir = process.env.PRODUCT_CONTENT_SNAPSHOTS_DIR || path.join(path.dirname(inventory),'product-content-snapshots');
  const promoDir = process.env.PROMOTIONS_SNAPSHOT_DIR || path.join(path.dirname(inventory),'promotion-snapshots');
  const [attributes,promotions,files] = await Promise.all([
    readAttributes(snapshot.syncedAt).catch(()=>null),
    readPromotionCodes(promoDir,day(snapshot.syncedAt)).catch(()=>null),
    fs.readdir(scoreDir).catch(()=>[]),
  ]);
  return {
    catalog:contentCatalogue(snapshot.products,attributes,promotions?.codes), catalogDate:snapshot.syncedAt,
    promoDate:promotions?.date ?? null,
    scoreDates:files.filter(name=>/^\d{4}-\d\d-\d\d\.json$/.test(name)).map(name=>name.slice(0,10)).sort(),
    readScore:async date=>{
      const scores = await readJson(path.join(scoreDir,date+'.json')).catch(()=>null);
      return scores && typeof scores === 'object' && !Array.isArray(scores) ? scores : null;
    },
  };
}

async function loadTraffic(selection) {
  const {from,to,device,source} = selection;
  const baseline = contentBaseline(selection);
  const key = JSON.stringify([day(Date.now()),from,to,baseline,device,source]);
  if (trafficCache?.key === key && trafficCache.expires > Date.now()) return trafficCache.value;
  trafficCache = null;
  const project = process.env.BIGQUERY_PROJECT_ID, dataset = process.env.BIGQUERY_DATASET_ID;
  const {BigQuery} = require(process.env.STUDIO_BIGQUERY_SDK || '@google-cloud/bigquery');
  const client = new BigQuery({projectId:project});
  const value = compactContentTraffic();
  const run = async options => {
    queried = queried.filter(time=>Date.now()-time < 3600000);
    if (queried.length >= 16) throw Error('content_query_budget');
    queried.push(Date.now());
    const [job] = await client.createQueryJob(options);
    let page = {autoPaginate:false,maxResults:15000};
    while (page) {
      const [rows,next] = await job.getQueryResults(page);
      value.add(rows);
      page = next;
    }
  };
  await readContentFunnel(run,project,dataset,[{key:'current',from,to},{key:'previous',...baseline}],selection);
  trafficCache = {key,value,expires:Date.now()+10*60_000};
  return value;
}

const pair = (row, field) => [row.before?.[field] ?? null,row.after?.[field] ?? null];
function exportContent(report, selection, rows) {
  const XLSX = require('xlsx');
  const cellRows = rows.map(row => {
    const base = [row.code,row.sku,row.name,row.category,row.brand,row.score];
    if (selection.table === 'improved') return [...base,row.scoreBefore,row.date,row.windowDays,
      row.beforeRange.from,row.beforeRange.to,row.afterRange.from,row.afterRange.to,
      ...pair(row,'sessions'),...pair(row,'atcRate'),row.atcChange,...pair(row,'purchaseRate'),row.change,
      ...pair(row,'purchases')];
    if (selection.table === 'history') return [...base,row.scoreBefore,row.date,...pair(row,'views'),
      ...pair(row,'purchaseRate'),row.change,...pair(row,'purchases'),...pair(row,'revenue'),row.control?.count,row.adjusted];
    if (selection.table === 'opportunity') return [...base,row.sessions,row.purchaseRate,row.target,row.gap,row.peers,
      row.missing.join(' · '),row.potentialOrders,row.potentialRevenue];
    return [...base,row.bucket === undefined ? null : report.groups[selection.table][row.bucket].label,row.photos,row.attributes,row.reviews,
      row.sessions,row.views,row.atcRate,row.purchaseRate,row.purchases,row.revenue,
      ...(selection.table === 'score' ? [] : [row.shipmentOrders,row.shipmentRevenue])];
  });
  const base = ['Код товару','Артикул','Назва','Категорія','Бренд','Content Score'];
  const columns = selection.table === 'improved'
    ? ['Бал до','Дата покращення','Днів у вікні','Початок до','Кінець до','Початок після','Кінець після',
      'PDP-сесії до','PDP-сесії після','Кошик до, %','Кошик після, %','Зміна кошика, п.п.',
      'Покупка до, %','Покупка після, %','Зміна покупки, п.п.','Покупок до','Покупок після']
    : selection.table === 'history'
    ? ['Бал до','Дата зміни','Перегляди до','Перегляди після','CR до, %','CR після, %','Зміна CR, п.п.',
      'Покупки до','Покупки після','Дохід GA4 до, грн','Дохід GA4 після, грн','Контроль, SKU','Зміна відносно контролю, п.п.']
    : selection.table === 'opportunity'
      ? ['PDP-сесії','CR, %','Медіанний CR, %','Різниця CR, п.п.','Аналоги, SKU','Недоліки',
        'Потенційні покупки','Потенційний дохід, грн']
      : ['Група','Фото','Характеристики, %','Відгуки','PDP-сесії','Перегляди PDP','PDP → ATC, %','PDP → Purchase, %',
        'Покупки SKU · GA4','Дохід SKU · GA4, грн',
        ...(selection.table === 'score' ? [] : ['Відвантаження SKU · ERP','Виторг SKU · ERP, грн'])];
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([[...base,...columns],...cellRows]);
  sheet['!autofilter'] = {ref:sheet['!ref']};
  sheet['!cols'] = [...base,...columns].map((heading,index)=>({wch:index===2 ? 58 : Math.min(36,Math.max(15,heading.length+3))}));
  XLSX.utils.book_append_sheet(book,sheet,'Контент × Конверсія');
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Період',report.range.from,report.range.to],
    ['Період порівняння',report.previous.from,report.previous.to],['Знімок каталогу',report.catalogDate],
    ['Дні GA4',report.coveredCurrent],['Дні Content Score',report.scoreDays],
    ['Фільтри',JSON.stringify(Object.fromEntries(Object.entries(selection).filter(([key])=>!['export','page'].includes(key))))]]),'Параметри');
  return XLSX.write(book,{bookType:'xlsx',type:'base64',compression:true});
}

export async function readContentConversion(selection, readERP) {
  const {table,sort,direction,page,bucket,export:download,...scope} = selection;
  const key = JSON.stringify(scope);
  if (reportCache?.key !== key || reportCache.expires <= Date.now()) {
    reportCache = null;
    const trafficTask = loadTraffic(scope).catch(error=>{
      console.error(JSON.stringify({event:'content_conversion_ga4',name:error.name,code:error.code,reason:error.errors?.[0]?.reason}));
      return null;
    });
    const [catalogue,traffic,erp] = await Promise.all([
      readCatalogue(),trafficTask,scope.device === 'all' && scope.source === 'all' ? readERP().catch(()=>null) : null,
    ]);
    const report = await buildContentReport({...catalogue,traffic,erp},scope);
    const expires = Date.now() + (traffic ? 5*60_000 : 45_000);
    reportCache = {key,report,expires};
  }
  const {tables,...summary} = reportCache.report;
  const detail = contentTable({tables},selection);
  return download === '1'
    ? {available:true,filename:`content-conversion-${scope.from}-${scope.to}.xlsx`,file:exportContent(summary,selection,detail.rows)}
    : {...summary,detail};
}
