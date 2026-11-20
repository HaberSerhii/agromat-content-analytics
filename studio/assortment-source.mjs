import fs from 'node:fs/promises';
import path from 'node:path';
import {gunzip} from 'node:zlib';
import {promisify} from 'node:util';
import {readSnapshotProducts} from './inventory-snapshot-stream.mjs';
import {addDays, rangeDays} from './public/overview-filters.mjs';
import {goodsOnlySalesRow,netSalesItems} from './erp-items.mjs';

const inflate = promisify(gunzip);
const dateName = /^\d{4}-\d\d-\d\d\.json\.gz$/;

async function snapshot(directory, date) {
  const filename = date + '.json.gz';
  try {
    const compact = JSON.parse(await inflate(await fs.readFile(path.join(directory,'availability-daily',filename))));
    if (compact.version === 1 && compact.date === date && Array.isArray(compact.products)) {
      return new Map(compact.products.map(([id,,,,flags])=>[id,Boolean(flags & 1)]));
    }
  } catch {}
  const status = new Map();
  await readSnapshotProducts(path.join(directory,filename),product=>status.set(product.id,Boolean(product.deleted)));
  return status;
}

export async function readAssortmentCatalogue(range, {directory = process.env.PRODUCT_SNAPSHOTS_DIR || '/var/lib/agromat-analytics/product-snapshots',
  catalogue = process.env.STUDIO_CATALOG_CACHE || '/var/cache/agromat-analytics/products-lite.json.gz'} = {}) {
  const openingDate = addDays(range.from,-1);
  const [before, after] = await Promise.all([snapshot(directory,openingDate),snapshot(directory,range.to)]);
  const candidates = new Map();
  for (const [id,archived] of after) {
    if (!archived && !before.has(id)) candidates.set(id,'new');
    if (archived && before.get(id) === false) candidates.set(id,'removed');
  }
  const codeOwners = new Map(), codes = new Map();
  await readSnapshotProducts(catalogue,product=>{
    const code = String(product.code ?? '').trim();
    if (!code || code === '0') return;
    if (!codeOwners.has(code)) codeOwners.set(code,product.id);
    else if (codeOwners.get(code) !== product.id) codeOwners.set(code,null);
    if (candidates.has(product.id)) codes.set(product.id,code);
  });
  const groups = new Map([...codes].filter(([id,code])=>codeOwners.get(code)===id).map(([id,code])=>[code,candidates.get(id)]));
  const files = await Promise.all([directory,path.join(directory,'availability-daily')].map(dir=>fs.readdir(dir).catch(()=>[])));
  const days = new Set(files.flat().filter(name=>dateName.test(name)).map(name=>name.slice(0,10)).filter(day=>day>=range.from&&day<=range.to));
  return {groups,coverage:{observed:days.size,days:rangeDays(range),matched:groups.size,candidates:candidates.size}};
}

export function assortmentImpact({groups,coverage}, rows, range, comparisonRange, includes, excluded, isSite = () => true) {
  const newSales = new Map();
  const siteNewSales = new Map();
  const existing = new Set();
  let first = '', removedRevenue = 0, removedPrevious = 0;
  const inPeriod = (date, period) => date >= period.from && date <= period.to;
  for (const raw of rows) {
    const date = raw.shippedDate;
    if (!date || !String(raw.state).toLocaleLowerCase('uk').includes('повністю відвантаж') || excluded(raw)) continue;
    if (!first || date < first) first = date;
    if (date > range.to || !raw.items.some(item=>groups.has(String(item.code).trim()))) continue;
    const row = goodsOnlySalesRow(raw);
    if (!row) continue;
    const current = inPeriod(date,range), previous = inPeriod(date,comparisonRange);
    if (date < range.from) for (const item of row.items) {
      const code = String(item.code).trim();
      if (groups.get(code) === 'new') existing.add(code);
    }
    if ((!current && !previous) || !includes(row)) continue;
    for (const item of netSalesItems(row)) {
      const code = String(item.code).trim(), group = groups.get(code);
      if (group === 'new' && current) {
        newSales.set(code,(newSales.get(code) || 0) + item.revenue);
        if (isSite(row)) siteNewSales.set(code,(siteNewSales.get(code) || 0) + item.revenue);
      }
      if (group === 'removed') {
        if (current) removedRevenue += item.revenue;
        if (previous) removedPrevious += item.revenue;
      }
    }
  }
  for (const code of existing) {
    newSales.delete(code);
    siteNewSales.delete(code);
  }
  const newRevenue = [...newSales.values()].reduce((sum,value)=>sum+value,0);
  const newSiteRevenue = [...siteNewSales.values()].reduce((sum,value)=>sum+value,0);
  const comparisonAvailable = Boolean(first && first <= comparisonRange.from);
  return {available:true,range,comparisonRange,coverage,added:[...groups.values()].filter(group=>group==='new').length-existing.size,
    sold:newSales.size,newRevenue,newSiteRevenue,removed:[...groups.values()].filter(group=>group==='removed').length,removedRevenue,
    removedPrevious:comparisonAvailable?removedPrevious:null,effect:comparisonAvailable?newRevenue-removedPrevious:null};
}
