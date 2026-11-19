import {calendarBins,addDays} from './public/chart-periods.mjs';

export const trafficFields = `LOWER(COALESCE(session_traffic_source_last_click.cross_channel_campaign.source, IF(session_traffic_source_last_click.google_ads_campaign.campaign_id IS NOT NULL,'google',NULL),session_traffic_source_last_click.manual_campaign.source,'')) AS traffic_source,
LOWER(COALESCE(session_traffic_source_last_click.cross_channel_campaign.medium,IF(session_traffic_source_last_click.google_ads_campaign.campaign_id IS NOT NULL,'cpc',NULL),session_traffic_source_last_click.manual_campaign.medium,'')) AS traffic_medium`;
export const acquisition = `CASE WHEN traffic_medium='cpc' THEN 'cpc' WHEN traffic_medium='organic' THEN 'organic' WHEN traffic_source='(direct)' AND traffic_medium='(none)' THEN 'direct' ELSE 'other' END`;
const device = `CASE WHEN device_category IN ('mobile','desktop') THEN device_category ELSE 'other' END`;
export const transaction = `COALESCE(NULLIF(NULLIF(TRIM(ecommerce.transaction_id),''),'(not set)'),(SELECT NULLIF(NULLIF(TRIM(COALESCE(value.string_value,CAST(value.int_value AS STRING))),''),'(not set)') FROM UNNEST(event_params) WHERE key='transaction_id'))`;
export const ga4Table = (project,dataset) => {
  if(!/^[\w-]+$/.test(project||'')||!/^\w+$/.test(dataset||''))throw Error('invalid_dataset');
  return `\`${project}.${dataset}.events_*\``;
};

export function overviewWebQuery(project,dataset,range,baseline) {
  const bins=new Map([['current',{key:'current',...range}],['previous',{key:'previous',...baseline}]]);
  for(const period of [range,baseline])for(const interval of ['day','week','month'])for(const bin of calendarBins(period,interval))bins.set(bin.from+':'+bin.to,{key:bin.from+':'+bin.to,from:bin.from,to:bin.to});
  return {
    query: `WITH base AS (
      SELECT event_date, event_name, user_pseudo_id, geo.country = @country AS is_ukraine,
        ${transaction} AS transaction_id,
        CAST((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS STRING) AS session_id,
        ${trafficFields}, LOWER(device.category) AS device_category
      FROM ${ga4Table(project,dataset)}
      WHERE ((_TABLE_SUFFIX BETWEEN @currentFrom AND @currentTo) OR (_TABLE_SUFFIX BETWEEN @previousFrom AND @previousTo))
        AND (geo.country = @country OR event_name IN ('purchase', 'payment_unpaid'))
    ), events AS (
      SELECT *, ${acquisition} AS acquisition, ${device} AS device FROM base
    ), expanded AS (
      SELECT b.key, e.*, channel AS selected_acquisition, selected_device
      FROM events e JOIN UNNEST(@bins) b ON e.event_date BETWEEN b.fromSuffix AND b.toSuffix,
        UNNEST([e.acquisition, 'all']) channel, UNNEST([e.device, 'all']) selected_device
    )
    SELECT key, selected_acquisition AS acquisition, selected_device AS device,
      COUNT(DISTINCT IF(is_ukraine, user_pseudo_id, NULL)) AS users,
      COUNT(DISTINCT IF(is_ukraine AND session_id IS NOT NULL, CONCAT(user_pseudo_id, '/', session_id), NULL)) AS sessions,
      COUNT(DISTINCT IF(is_ukraine AND event_name = 'purchase', transaction_id, NULL)) AS purchases,
      COUNT(DISTINCT IF(is_ukraine AND event_name = 'session_start', user_pseudo_id, NULL)) AS landing,
      COUNT(DISTINCT IF(is_ukraine AND event_name = 'view_item', user_pseudo_id, NULL)) AS view_item,
      COUNT(DISTINCT IF(is_ukraine AND event_name = 'add_to_cart', user_pseudo_id, NULL)) AS cart,
      COUNT(DISTINCT IF(is_ukraine AND event_name = 'begin_checkout', user_pseudo_id, NULL)) AS begin_checkout,
      COUNT(DISTINCT IF(event_name IN ('purchase', 'payment_unpaid'), transaction_id, NULL)) AS purchase,
      FORMAT_DATE('%F', PARSE_DATE('%Y%m%d', MIN(IF(is_ukraine, event_date, NULL)))) AS data_from,
      FORMAT_DATE('%F', PARSE_DATE('%Y%m%d', MAX(IF(is_ukraine, event_date, NULL)))) AS data_through
    FROM expanded GROUP BY key, selected_acquisition, selected_device`,
    params:{currentFrom:range.from.replaceAll('-',''),currentTo:range.to.replaceAll('-',''),previousFrom:baseline.from.replaceAll('-',''),previousTo:baseline.to.replaceAll('-',''),country:'Ukraine',bins:[...bins.values()].map(bin=>({key:bin.key,fromSuffix:bin.from.replaceAll('-',''),toSuffix:bin.to.replaceAll('-','')}))},
    maximumBytesBilled:'20000000000',useQueryCache:true,jobTimeoutMs:60000,
  };
}

export function overviewTransactionsQuery(project,dataset,periods,ids) {
  if(!ids.length||ids.length>50000)throw Error('invalid_transaction_ids');
  const ranges=periods.map((period,index)=>`(_TABLE_SUFFIX BETWEEN @from${index} AND @to${index})`).join(' OR ');
  return {
    query:`WITH base AS (SELECT ${transaction} AS transactionId,${trafficFields},LOWER(device.category) AS device_category FROM ${ga4Table(project,dataset)} WHERE (${ranges}) AND event_name IN ('purchase','payment_unpaid')) SELECT DISTINCT transactionId,${acquisition} AS acquisition,${device} AS device FROM base WHERE transactionId IN UNNEST(@ids)`,
    params:{ids,...Object.fromEntries(periods.flatMap((period,index)=>[[`from${index}`,period.from.replaceAll('-','')],[`to${index}`,period.to.replaceAll('-','')]]))},
    maximumBytesBilled:'20000000000',useQueryCache:true,jobTimeoutMs:60000,
  };
}

export function transactionLookback(rows,period) {
  const floor=addDays(period.from,-365);
  const dates=rows.filter(row=>(row.shippedDate>=period.from&&row.shippedDate<=period.to)||(row.createdDate>=period.from&&row.createdDate<=period.to)).map(row=>row.createdDate).filter(date=>date&&date>=floor&&date<=period.to).sort();
  return {from:dates[0]||period.from,to:period.to};
}

const exceedsBytes=error=>error.errors?.some(item=>item.reason==='bytesBilledLimitExceeded');

// Partition transaction lookups without dropping records. Exact-ID deduplication is performed after every partition is complete.
export async function readBoundedTransactions(run,project,dataset,periods,ids) {
  try {return await run(overviewTransactionsQuery(project,dataset,periods,ids));}
  catch(error){
    if(!exceedsBytes(error))throw error;
    if(periods.length>1){const rows=[];for(const period of periods)rows.push(...await readBoundedTransactions(run,project,dataset,[period],ids));return rows;}
    const period=periods[0],days=Math.round((Date.parse(period.to)-Date.parse(period.from))/86400000)+1;
    if(days<=1)throw error;
    const end=addDays(period.from,Math.floor(days/2)-1);
    return [...await readBoundedTransactions(run,project,dataset,[{from:period.from,to:end}],ids),...await readBoundedTransactions(run,project,dataset,[{from:addDays(end,1),to:period.to}],ids)];
  }
}

export async function readBoundedWeb(run,project,dataset,range,baseline) {
  try {return await run(overviewWebQuery(project,dataset,range,baseline));}
  catch(error){
    if(!exceedsBytes(error))throw error;
    // Distinct users cannot be summed across days. Keep each whole period intact.
    const current=await run(overviewWebQuery(project,dataset,range,range));
    const previous=await run(overviewWebQuery(project,dataset,baseline,baseline));
    return [...current.filter(row=>row.key!=='previous'),...previous.filter(row=>row.key!=='current')];
  }
}
