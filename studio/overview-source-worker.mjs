import fs from 'node:fs/promises';
import {deserialize} from 'node:v8';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline';
import {buildOverviewAttribution,validateSelection,erpChannel} from './overview-attribution.mjs';
import {readBoundedWeb,readBoundedTransactions,transactionLookback} from './overview-query.mjs';
import {catalogSelection, loadCatalogHealth} from './catalog-health.mjs';
import {comparisonRange, hasWebSlice} from './public/overview-filters.mjs';

let erp,origins;
const reports=new Map();
let sourceQueue=Promise.resolve(),queued=0,started=[];
async function readERP() {
  const filename=process.env.STUDIO_ERP_ROWS_CACHE||'/var/cache/agromat-analytics/sales-rows-v3.bin';
  const stat=await fs.stat(filename);
  if(erp?.mtime===stat.mtimeMs&&Date.now()-Date.parse(erp.updatedAt)<24*3600000)return erp;
  const entry=deserialize(await fs.readFile(filename));
  if(!Array.isArray(entry.value?.rows)||Date.now()-entry.createdAt>24*3600000)throw Error('erp_cache_unavailable');
  return erp={rows:entry.value.rows,mtime:stat.mtimeMs,updatedAt:new Date(entry.createdAt).toISOString()};
}
async function readOrigins() {
  if(origins&&Date.now()-origins.time<6*3600000)return origins.ids;
  if(!process.env.AGROMAT_API_KEY)throw Error('origin_source_unavailable');
  const base=(process.env.AGROMAT_API_BASE_URL||'https://www.agromat.ua/api/v1').replace(/\/$/,'');
  if(new URL(base).hostname!=='www.agromat.ua')throw Error('invalid_origin_source');
  const ids=new Set();
  async function page(number) {
    const response=await fetch(base+'/orders/?'+new URLSearchParams({page:String(number),per_page:'100',with_movements:'false',source:'rozetka'}),{headers:{Accept:'application/json','X-API-Key':process.env.AGROMAT_API_KEY},signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error('origin_source_unavailable');
    const value=await response.json();
    if(!Array.isArray(value.data)||!Number.isInteger(value.meta?.total_pages)||value.meta.total_pages>400)throw Error('origin_source_incomplete');
    for(const row of value.data)if(String(row.origin?.source||'').toLowerCase()==='rozetka')ids.add(String(row.id));
    return value.meta.total_pages;
  }
  const pages=await page(1);
  for(let start=2;start<=pages;start+=4)await Promise.all(Array.from({length:Math.min(4,pages-start+1)},(_,index)=>page(start+index)));
  origins={time:Date.now(),ids};return ids;
}

async function readOverviewSelection(input, options) {
  const state=validateSelection(input),range={from:state.from,to:state.to},baseline=comparisonRange(range,state.compareMode);
  const [source,rozetka]=await Promise.all([readERP(),readOrigins()]);
  const key=JSON.stringify([range,baseline,source.mtime]);
  const readTransactions = (run, project, dataset, periods) => {
    const rows = source.rows.filter(row => erpChannel(row, rozetka) === 'site' && periods.some(({from, to}) =>
      (row.shippedDate >= from && row.shippedDate <= to) || (row.createdDate >= from && row.createdDate <= to)));
    const ids = [...new Set(rows.map(row => String(row.webshopId || '')).filter(id => id && id !== '0'))];
    return ids.length ? readBoundedTransactions(run, project, dataset, periods.map(period => transactionLookback(rows, period)), ids) : Promise.resolve([]);
  };
  const querySource = () => {
    const require = createRequire('/opt/agromat-content-analytics/package.json');
    const {BigQuery} = require(process.env.STUDIO_BIGQUERY_SDK || '/opt/agromat-content-analytics/node_modules/@google-cloud/bigquery');
    const project = process.env.BIGQUERY_PROJECT_ID, dataset = process.env.BIGQUERY_DATASET_ID;
    const client = new BigQuery({projectId: project});
    const run = async query => {
      started = started.filter(time => Date.now() - time < 3600000);
      if (started.length >= 24) throw Error('overview_query_budget');
      started.push(Date.now());
      const [rows] = await client.query(query);
      return rows;
    };
    return {run, project, dataset};
  };
  let report=reports.get(key);
  if(!report||Date.now()-report.time>(report.attributionAvailable&&report.webAvailable?6*3600000:60000)){
    const {run, project, dataset} = querySource();
    const [web,transactions]=await Promise.allSettled([
      readBoundedWeb(run,project,dataset,range,baseline),
      readTransactions(run,project,dataset,[range,baseline]),
    ]);
    report={time:Date.now(),webRows:web.status==='fulfilled'?web.value:[],transactions:transactions.status==='fulfilled'?transactions.value:[],webAvailable:web.status==='fulfilled',attributionAvailable:transactions.status==='fulfilled'};
    if(reports.size>=6)reports.delete(reports.keys().next().value);
    reports.set(key,report);
  }
  if(!report.attributionAvailable && hasWebSlice(state))throw Error('attribution_unavailable');
  let previousYearTransactions;
  if (state.compareMode !== 'yoy' && hasWebSlice(state)) {
    if (!report.lastYear || (report.lastYear.rows === null && Date.now() - report.lastYear.time > 60000)) {
      const {run, project, dataset} = querySource();
      const rows = await readTransactions(run, project, dataset, [comparisonRange(range, 'yoy')]).catch(() => null);
      report.lastYear = {time:Date.now(), rows};
    }
    previousYearTransactions = report.lastYear.rows;
  }
  const result=buildOverviewAttribution({rows:source.rows,rozetkaIds:[...rozetka],updatedAt:source.updatedAt,...report,previousYearTransactions},state,options);
  result.attribution.available=report.attributionAvailable;
  result.partial=!report.attributionAvailable||!report.webAvailable;
  if(result.partial)result.sourceNotice='Частина даних GA4 тимчасово недоступна; відвантаження ERP показані повністю.';
  return result;
}

export function loadOverviewSelection(input, options) {
  const selection=validateSelection(input);
  if(queued>=12)return Promise.reject(Error('overview_busy'));
  queued++;
  const task=sourceQueue.then(()=>readOverviewSelection(selection, options));
  sourceQueue=task.catch(()=>{});
  return task.finally(()=>queued--);
}

export async function readOverviewCatalog(params = new URLSearchParams()) {
  const selection = catalogSelection(params);
  const source = await readERP();
  return loadCatalogHealth(source.rows, selection);
}

if(process.argv.includes('--stdio')) {
  for(const filename of ['/opt/agromat-content-analytics/.env','/opt/agromat-content-analytics/.env.local','/opt/agromat-studio/runtime.env'])try{process.loadEnvFile(filename);}catch{}
  const lines=createInterface({input:process.stdin});
  for await(const line of lines) {
    let request;
    try {request=JSON.parse(line);const value=request.kind==='catalog-health' ? await readOverviewCatalog(new URLSearchParams(request.selection)) : await loadOverviewSelection(request.selection,{includeMargin:true});process.stdout.write(JSON.stringify({id:request.id,value})+'\n');}
    catch(error){process.stderr.write(JSON.stringify({event:'overview_source_error',query:error.queryKind,code:error.code,name:error.name,reason:error.errors?.[0]?.reason,message:(error.errors?.[0]?.message||(['TypeError','ReferenceError'].includes(error.name)?error.message:undefined))?.slice(0,300)})+'\n');process.stdout.write(JSON.stringify({id:request?.id,value:{available:false,notice:'Не вдалося отримати повний зв’язок відвантажень ERP з GA4.',error:['invalid_range','invalid_filter','comparison_unavailable','marketplace_web_filter','duplicate_erp_document'].includes(error.message)?error.message:'source_unavailable'}})+'\n');}
  }
}
