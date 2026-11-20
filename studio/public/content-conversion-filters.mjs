import {yearBefore} from './chart-periods.mjs';
import {addDays, rangeDays} from './overview-filters.mjs';

export const contentDevices = [['all','Усі'], ['mobile','Мобільний'], ['desktop','Комп’ютер'], ['tablet','Планшет'], ['other','Інший']];
export const contentSources = [['all','Усі'], ['direct','Direct'], ['organic','Organic'], ['cpc','CPC'], ['other','Інші / невідомі']];
export const contentPriceBands = [['low','До 1 000 ₴'], ['middle','1 000–4 999,99 ₴'], ['high','Від 5 000 ₴'], ['unknown','Ціна невідома']];
export const contentSorts = ['name','score','views','atcRate','purchaseRate','purchases','revenue','shipmentRevenue','shipmentOrders','change','atcChange','potentialRevenue','date','sessions','photos','attributes','reviews','target','gap','potentialOrders','adjusted'];
export const contentGroups = {
  score:['0–20','21–40','41–60','61–80','81–100'],
  photos:['0','1','2','3–4','5–7','8+'],
  attributes:['0–25%','26–50%','51–75%','76–99%','100%'],
  reviews:['0','1','2–3','4+'],
};
export const contentTables = ['score','photos','attributes','reviews','history','improved','opportunity'];
export const minimumContentSample = 100;

export function contentDefaults(today) {
  return {from:addDays(today,-30),to:addDays(today,-1),comparison:'prior'};
}

export function contentBaseline({from,to,comparison}) {
  const days = rangeDays({from,to});
  const start = comparison === 'year' ? yearBefore(from) : addDays(from,-days);
  return {from:start,to:addDays(start,days-1)};
}

export function contentSelection(input, today = new Date().toLocaleDateString('sv-SE', {timeZone:'Europe/Kyiv'})) {
  const params = input instanceof URLSearchParams ? input : new URLSearchParams(input);
  const keys = ['from','to','comparison','root','category','brand','price','stock','promo','device','source',
    'minScore','maxScore','search','table','bucket','sort','direction','page','export'];
  for (const key of params.keys()) {
    if (!keys.includes(key) || params.getAll(key).length !== 1) throw Error('invalid_content_selection');
  }
  const result = {...contentDefaults(today),...Object.fromEntries(params)};
  for (const value of [result.from,result.to]) {
    if (!/^\d{4}-\d\d-\d\d$/.test(value) || !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0,10) !== value || value < '2020-01-01' || value >= today) {
      throw Error('invalid_content_range');
    }
  }
  if (rangeDays(result) < 1 || rangeDays(result) > 90) throw Error('invalid_content_range');
  for (const [key, allowed, fallback] of [
    ['comparison',['prior','year'],'prior'],
    ['device',contentDevices.map(([id])=>id),'all'],['source',contentSources.map(([id])=>id),'all'],
    ['price',['all',...contentPriceBands.map(([id])=>id)],'all'],['stock',['all','in','out','unknown'],'in'],
    ['promo',['all','yes','no','unknown'],'all'],['table',contentTables,'score'],
    ['sort',contentSorts,result.table==='improved'?'change':'views'],['direction',['asc','desc'],'desc'],['export',['0','1'],'0'],
  ]) {
    result[key] ??= fallback;
    if (!allowed.includes(result[key])) throw Error('invalid_content_selection');
  }
  // Requests from older tabs still carry the previous stock filter values.
  result.stock = 'in';
  for (const key of ['root','category','brand','search']) {
    result[key] = (result[key] ?? '').trim();
    if (result[key].length > 160 || /[\u0000-\u001f]/.test(result[key])) throw Error('invalid_content_filter');
  }
  for (const [key, min, max, fallback] of [['minScore',0,100,0],['maxScore',0,100,100],['page',1,5000,1]]) {
    const raw = result[key] ?? '';
    if (raw && !/^\d{1,4}$/.test(raw)) throw Error('invalid_content_filter');
    result[key] = raw ? Number(raw) : fallback;
    if (result[key] < min || result[key] > max) throw Error('invalid_content_filter');
  }
  result.bucket ??= '';
  if (result.bucket !== '' && (!/^\d$/.test(result.bucket) ||
      Number(result.bucket) >= (contentGroups[result.table]?.length ?? 0))) throw Error('invalid_content_filter');
  if (result.minScore > result.maxScore) throw Error('invalid_content_filter');
  return result;
}
