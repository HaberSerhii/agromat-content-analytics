const NAME='studio-overview-snapshot-v1',MAX_AGE=24*3600000,MAX_BYTES=1024*1024;
const fields=['sales','chartSales','users','history','salesChannels','quarterChannels','quarterTraffic','categorySales','siteFunnel','priceIndex','products','stock','content'];
export function overviewCacheKey(state,today){return JSON.stringify([today,state.from,state.to,state.chartChannel,state.chartSegment,!!state.yoy,state.categoryPeriod,state.funnelMode,state.category,state.brand]);}
export function createOverviewCache({storage=()=>globalThis.localStorage,now=()=>Date.now()}={}){
 return {
  read(key){try{const raw=storage().getItem(NAME);if(!raw||raw.length>MAX_BYTES)return null;const record=JSON.parse(raw);if(record.key!==key||!Number.isFinite(record.savedAt)||now()-record.savedAt<0||now()-record.savedAt>MAX_AGE||!record.data?.sales?.available)return null;return record;}catch{return null;}},
  write(key,data){if(!data.sales?.available)return;try{const safe={};for(const field of fields)if(data[field]!==undefined)safe[field]=data[field];const raw=JSON.stringify({key,savedAt:now(),data:safe});if(raw.length<=MAX_BYTES)storage().setItem(NAME,raw);}catch{}}
 };
}
