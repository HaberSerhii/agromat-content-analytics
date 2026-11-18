import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {addDays} from './public/chart-periods.mjs';
import {comparisonRange, overviewDefaults} from './public/overview-filters.mjs';
import {dates} from './data.mjs';

const labels = ['Плитка', 'Сантехніка', 'Підлогові покриття', 'Будівельна хімія'];
const trafficCategories = new Map([
  ['Плитка', {root:'Плитка', categories:['Плитка', 'Мозаїка', 'Декорація']}],
  ['Сантехніка', {root:'Сантехніка', categories:[
    'Сантехнічна кераміка', 'Змішувачі', 'Душові системи', 'Теплотехніка',
    'Ванни', 'Аксесуари', 'Душові кабіни', 'Меблі для ванної кімнати',
    'Інсталяції', 'Сифони', 'Душові канали та трапи', 'Басейни',
  ]}],
  ['Підлогові покриття', {root:'Підлогове покриття', categories:['Вінілова підлога', 'Ламінат', 'Паркет']}],
]);
const plumbingRoots = new Set([
  'Сантехніка', 'Змішувачі', 'Душові кабіни та системи', 'Унітази та інсталяції',
  'Раковини та умивальники', 'Рушникосушарки', 'Ванни', 'Кухонні мийки',
]);
const unzip = promisify(gunzip);

export function catalogSegment(product, erpKey = '') {
  // Use the same ERP groups as classifySalesCategory; catalog roots cover unsold SKUs.
  const [root, branch] = erpKey.split('.');
  if (root === '001') return labels[0];
  if (root === '002') return labels[1];
  if (root === '009') return labels[2];
  if (root === '007' || (root === '003' && /^(001|002|004|008|011|012|014|015|016|017|020|021|022|023|024)$/.test(branch))) return labels[3];
  if (erpKey) return null;
  const catalogRoot = (product.categoryPath || product.categoryName || '').split(/[/›>]/)[0].trim();
  if (catalogRoot === 'Плитка') return labels[0];
  if (plumbingRoots.has(catalogRoot)) return labels[1];
  if (['Підлогове покриття', 'Підлогові покриття'].includes(catalogRoot)) return labels[2];
  if (catalogRoot === 'Будівельна хімія') return labels[3];
  return null;
}

export function catalogGroups(products, scores, erpKeys) {
  const groups = new Map(labels.map(label => [label, {label, inStock:0, stocked:new Set(), scores:[], refs:new Set()}]));
  const unique = new Set();
  for (const product of products) {
    if (product.deleted || unique.has(product.id)) continue;
    unique.add(product.id);
    const group = groups.get(catalogSegment(product, erpKeys.get(String(product.code))));
    if (!group) continue;
    if (product.stockQty >= 1) {
      group.inStock++;
      group.stocked.add(product.id);
    }
    const score = scores?.[product.code];
    if (Number.isFinite(score)) group.scores.push(score);
    if (Number.isSafeInteger(product.goodsRef) && product.goodsRef > 0) group.refs.add(product.goodsRef);
  }
  return [...groups.values()];
}

export function catalogSelection(params, today = new Date().toLocaleDateString('sv-SE', {timeZone:'Europe/Kyiv'})) {
  const range = dates(params, today);
  const mode = params.get('compareMode') || overviewDefaults(today).compareMode;
  if (range.to >= today || !['wow','mom','yoy'].includes(mode)) throw Error('invalid_catalog_selection');
  return {range, mode, baseline:comparisonRange(range, mode)};
}

export function catalogTrafficReferences(groups) {
  const memberships = new Map();
  for (const {refs} of groups) {
    for (const ref of refs) memberships.set(ref, (memberships.get(ref) ?? 0) + 1);
  }
  return groups.flatMap(({label:segment, refs}) => {
    const nullOnly = trafficCategories.has(segment);
    return [...refs].filter(ref => !nullOnly || memberships.get(ref) === 1)
      .map(ref => ({segment, ref, nullOnly}));
  });
}

async function readTraffic(groups, {range, baseline}) {
  const configured = [
    process.env.BIGQUERY_PROJECT_ID,
    process.env.BIGQUERY_DATASET_ID,
    process.env.BIGQUERY_PRODUCT_EVENTS_TABLE || 'items_detailed_events',
  ];
  if (configured.some(part => !/^[\w-]+$/.test(part || ''))) return null;
  const refs = catalogTrafficReferences(groups);
  const gaCategories = [...trafficCategories].flatMap(([segment, {root, categories}]) =>
    categories.map(category => ({segment, root, category})));
  const require = createRequire('/opt/agromat-content-analytics/package.json');
  const {BigQuery} = require(process.env.STUDIO_BIGQUERY_SDK || '/opt/agromat-content-analytics/node_modules/@google-cloud/bigquery');
  const client = new BigQuery({projectId:configured[0]});
  const [rows] = await client.query({
    query: `WITH events AS (
      SELECT period.name AS period, e.event_name, e.item_id, e.item_category, e.item_category2
      FROM \`${configured.join('.')}\` e
      JOIN UNNEST(@periods) period ON e.event_date BETWEEN CAST(period.startDate AS DATE) AND CAST(period.endDate AS DATE)
      WHERE (event_date BETWEEN DATE(@from) AND DATE(@to)
        OR event_date BETWEEN DATE(@priorFrom) AND DATE(@priorTo))
        AND event_name IN ('view_item_list','view_item')
    )${refs.length ? `, item_totals AS (
      SELECT period, SAFE_CAST(NULLIF(TRIM(item_id), '') AS INT64) AS ref,
        item_category IS NULL AS category_missing,
        COUNTIF(event_name = 'view_item_list') AS impressions,
        COUNTIF(event_name = 'view_item') AS views
      FROM events
      GROUP BY 1, 2, 3
    )` : ''}, segment_totals AS (
      SELECT e.period, g.segment,
        COUNTIF(e.event_name = 'view_item_list') AS impressions,
        COUNTIF(e.event_name = 'view_item') AS views
      FROM events e
      JOIN UNNEST(@gaCategories) g
        ON TRIM(e.item_category) = g.root AND TRIM(e.item_category2) = g.category
      GROUP BY 1, 2
      ${refs.length ? `UNION ALL
      SELECT i.period, r.segment, SUM(i.impressions), SUM(i.views)
      FROM item_totals i
      JOIN UNNEST(@refs) r ON i.ref = r.ref
      WHERE NOT r.nullOnly OR i.category_missing
      GROUP BY 1, 2` : ''}
    )
    SELECT period, segment, SUM(impressions) AS impressions, SUM(views) AS views
    FROM segment_totals GROUP BY 1, 2`,
    params: {
      ...range, priorFrom:baseline.from, priorTo:baseline.to,
      ...(refs.length ? {refs} : {}),
      gaCategories,
      periods:[
        {name:'current', startDate:range.from, endDate:range.to},
        {name:'previous', startDate:baseline.from, endDate:baseline.to},
      ],
    },
    location:'EU', maximumBytesBilled:'20000000000', useQueryCache:true, jobTimeoutMs:60000,
  });
  return new Map(rows.map(row => [row.period + ":" + row.segment, row]));
}

const meanScore = group => group?.scores.length
  ? group.scores.reduce((sum, score) => sum + score, 0) / group.scores.length : null;
const difference = (current, previous) => current == null || previous == null ? null : current - previous;
const kyivDay = timestamp => new Date(timestamp).toLocaleDateString('sv-SE', {timeZone:'Europe/Kyiv'});

export function stockMovement(current, previous) {
  if (!previous) return null;
  return {
    gained:[...current].filter(id => !previous.has(id)).length,
    lost:[...previous].filter(id => !current.has(id)).length,
    net:current.size - previous.size,
  };
}

async function readCatalogHealth(salesRows, selection) {
  const cachePath = process.env.STUDIO_CATALOG_CACHE || '/var/cache/agromat-analytics/products-lite.json.gz';
  const snapshot = JSON.parse(await unzip(await fs.readFile(cachePath)));
  if (!Array.isArray(snapshot.products)) throw Error('invalid_catalog_snapshot');
  const today = kyivDay(new Date());
  const scoreDir = process.env.PRODUCT_CONTENT_SNAPSHOTS_DIR || '/var/lib/agromat-analytics/product-content-snapshots';
  const scoreFile = (await fs.readdir(scoreDir).catch(()=>[]))
    .filter(file => /^\d{4}-\d{2}-\d{2}\.json$/.test(file) && file.slice(0,10) <= today).sort().at(-1);
  const scores = scoreFile ? await fs.readFile(path.join(scoreDir, scoreFile),'utf8').then(JSON.parse).catch(()=>null) : null;
  const erpKeys = new Map();
  for (const sale of salesRows) {
    const date = sale.shippedDate || sale.createdDate || '';
    for (const item of sale.items || []) {
      const code = String(item.code);
      if (item.categoryKey && (!erpKeys.has(code) || date >= erpKeys.get(code).date)) {
        erpKeys.set(code, {date, key:item.categoryKey});
      }
    }
  }
  const keys = new Map([...erpKeys].map(([code, entry]) => [code, entry.key]));
  const groups = catalogGroups(snapshot.products, scores, keys);
  const stockDate = kyivDay(snapshot.syncedAt);
  const scoreDate = scores ? scoreFile.slice(0,10) : null;
  const stockStart = stockDate.slice(0,7) + '-01';
  const scoreStart = scoreDate && scoreDate.slice(0,7) + '-01';
  const stockPriorDay = addDays(stockDate,-1);
  const scorePriorDay = scoreDate && addDays(scoreDate,-1);
  const inventoryDir = process.env.PRODUCT_SNAPSHOTS_DIR || '/var/lib/agromat-analytics/product-snapshots';
  async function historicalStock(date) {
    if (date === stockDate) return groups;
    try {
      const historical = JSON.parse(await unzip(await fs.readFile(path.join(inventoryDir,date + '.json.gz'))));
      return Array.isArray(historical.products) ? catalogGroups(historical.products,null,keys) : null;
    } catch { return null; }
  }
  async function historicalScore(date) {
    if (!date) return null;
    if (date === scoreDate) return groups;
    try {
      const historical = JSON.parse(await fs.readFile(path.join(scoreDir,date + '.json'),'utf8'));
      return catalogGroups(snapshot.products,historical,keys);
    } catch { return null; }
  }
  const monthStock = await historicalStock(stockStart);
  const dayStock = await historicalStock(stockPriorDay);
  const monthScore = await historicalScore(scoreStart);
  const dayScore = await historicalScore(scorePriorDay);
  const traffic = await readTraffic(groups, selection).catch(error => {
    console.error('catalog_traffic_unavailable', error.code || error.name, error.errors?.[0]?.reason || '', error.errors?.[0]?.message?.slice(0,180) || '');
    return null;
  });
  const viewsRate = row => Number(row?.impressions) > 0 ? Number(row.views) / Number(row.impressions) * 100 : null;
  return {
    available:true, updatedAt:snapshot.syncedAt, stockDate, scoreDate, stockStart, scoreStart, stockPriorDay, scorePriorDay,
    trafficRange:selection.range, comparisonRange:selection.baseline, compareMode:selection.mode, partial:!traffic || !scores,
    segments:groups.map((group,index) => {
      const current = traffic?.get('current:' + group.label);
      const previous = traffic?.get('previous:' + group.label);
      const score = meanScore(group);
      const stockBase = monthStock?.[index];
      const scoreBase = meanScore(monthScore?.[index]);
      const impressions = current ? Number(current.impressions) : null;
      const priorImpressions = previous ? Number(previous.impressions) : null;
      const ctr = viewsRate(current);
      const priorCtr = viewsRate(previous);
      return {
        label:group.label, inStock:group.inStock, impressions, ctr, score,
        stockBase:stockBase?.inStock ?? null,
        stockMovement:stockMovement(group.stocked,stockBase?.stocked),
        stockDaily:difference(group.inStock,dayStock?.[index]?.inStock),
        scoreBase, scoreChange:difference(score,scoreBase),
        scoreDaily:difference(score,meanScore(dayScore?.[index])),
        priorImpressions, priorCtr,
        impressionsChange:impressions != null && priorImpressions > 0 ? (impressions / priorImpressions - 1) * 100 : null,
        ctrChange:difference(ctr,priorCtr),
      };
    }),
  };
}

const cache = new Map();
const pending = new Map();
let started = [];
export async function loadCatalogHealth(salesRows, selection) {
  const key = JSON.stringify(selection);
  const hit = cache.get(key);
  if (hit?.until > Date.now()) return hit.value;
  if (pending.has(key)) return pending.get(key);
  started = started.filter(time => Date.now() - time < 3600000);
  if (pending.size >= 2 || started.length >= 24) throw Error('catalog_query_budget');
  started.push(Date.now());
  const task = readCatalogHealth(salesRows,selection).then(value => {
    if (cache.size >= 12) cache.delete(cache.keys().next().value);
    cache.set(key,{value,until:Date.now() + (value.partial ? 60_000 : 10 * 60_000)});
    return value;
  }).finally(()=>pending.delete(key));
  pending.set(key,task);
  return task;
}
