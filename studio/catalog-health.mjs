import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {addDays} from './public/chart-periods.mjs';

const labels = ['Плитка', 'Сантехніка', 'Підлогові покриття', 'Будівельна хімія'];
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
  const groups = new Map(labels.map(label => [label, {label, inStock:0, scores:[], refs:new Set()}]));
  const unique = new Set();
  for (const product of products) {
    if (product.deleted || unique.has(product.id)) continue;
    unique.add(product.id);
    const group = groups.get(catalogSegment(product, erpKeys.get(String(product.code))));
    if (!group) continue;
    if (product.stockQty >= 1) group.inStock++;
    const score = scores?.[product.code];
    if (Number.isFinite(score)) group.scores.push(score);
    if (Number.isSafeInteger(product.goodsRef) && product.goodsRef > 0) group.refs.add(product.goodsRef);
  }
  return [...groups.values()];
}

function currentTrafficRange(today) {
  const to = addDays(today, -1);
  return {from: to.slice(0,7) + '-01', to};
}

async function readTraffic(groups, range) {
  const configured = [
    process.env.BIGQUERY_PROJECT_ID,
    process.env.BIGQUERY_DATASET_ID,
    process.env.BIGQUERY_PRODUCT_EVENTS_TABLE || 'items_detailed_events',
  ];
  if (configured.some(part => !/^[\w-]+$/.test(part || ''))) return null;
  const refs = groups.flatMap(group => [...group.refs].map(ref => ({segment:group.label, ref})));
  if (!refs.length) return null;
  const require = createRequire('/opt/agromat-content-analytics/package.json');
  const {BigQuery} = require(process.env.STUDIO_BIGQUERY_SDK || '/opt/agromat-content-analytics/node_modules/@google-cloud/bigquery');
  const client = new BigQuery({projectId:configured[0]});
  const [rows] = await client.query({
    query: `SELECT r.segment, COUNTIF(e.event_name = 'view_item_list') AS impressions,
      COUNTIF(e.event_name = 'view_item') AS views
      FROM \`${configured.join('.')}\` e
      JOIN UNNEST(@refs) r ON SAFE_CAST(NULLIF(TRIM(e.item_id), '') AS INT64) = r.ref
      WHERE e.event_date BETWEEN DATE(@from) AND DATE(@to)
        AND e.event_name IN ('view_item_list','view_item')
      GROUP BY r.segment`,
    params: {...range, refs},
    location:'EU', maximumBytesBilled:'20000000000', useQueryCache:true, jobTimeoutMs:60000,
  });
  return new Map(rows.map(row => [row.segment, row]));
}

async function readCatalogHealth(salesRows) {
  const cachePath = process.env.STUDIO_CATALOG_CACHE || '/var/cache/agromat-analytics/products-lite.json.gz';
  const snapshot = JSON.parse(await unzip(await fs.readFile(cachePath)));
  if (!Array.isArray(snapshot.products)) throw Error('invalid_catalog_snapshot');
  const today = new Date().toLocaleDateString('sv-SE', {timeZone:'Europe/Kyiv'});
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
  const groups = catalogGroups(snapshot.products, scores, new Map([...erpKeys].map(([code, entry])=>[code,entry.key])));
  const trafficRange = currentTrafficRange(today);
  const traffic = await readTraffic(groups, trafficRange).catch(()=>null);
  return {
    available:true, updatedAt:snapshot.syncedAt, scoreDate:scores ? scoreFile.slice(0,10) : null,
    trafficRange, partial:!traffic || !scores,
    segments:groups.map(group => {
      const impressions = traffic && group.refs.size ? Number(traffic.get(group.label)?.impressions || 0) : null;
      return {
        label:group.label, inStock:group.inStock, impressions,
        ctr:impressions > 0 ? Number(traffic.get(group.label).views) / impressions * 100 : null,
        score:group.scores.length ? group.scores.reduce((sum, score)=>sum+score,0) / group.scores.length : null,
      };
    }),
  };
}

let cached, pending;
export async function loadCatalogHealth(salesRows) {
  if (cached?.until > Date.now()) return cached.value;
  if (!pending) pending = readCatalogHealth(salesRows).then(value => {
    cached = {value, until:Date.now() + (value.partial ? 60_000 : 10 * 60_000)};
    return value;
  }).finally(()=>{pending = null;});
  return pending;
}
