const keys=['landing','view_item','cart','begin_checkout','purchase'];
export function funnelSafe(raw){
 const comparison=raw?.comparisons?.all;
 if(!comparison)return {available:false};
 const period=p=>p?{from:p.from,to:p.to,available:p.available===true,stages:keys.map(key=>({key,value:Number.isFinite(p.stages?.find(s=>s.key===key)?.users)?p.stages.find(s=>s.key===key).users:null}))}:null;
 return {available:comparison.current?.available===true,current:period(comparison.current),previous:period(comparison.previous),yearAgo:period(comparison.yearAgo)};
}
const cache=new Map(),pending=new Map();
export async function readSiteFunnel(mode,origin,auth){
 const day=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Kyiv'}),key=mode+day;
 if(cache.has(key))return cache.get(key);
 if(pending.has(key))return pending.get(key);
 const task=(async()=>{try{
 const response=await fetch(origin+'/api/promotions/web-funnel?period='+mode,{headers:{'x-agromat-dashboard-auth':auth||'',Accept:'application/json'},signal:AbortSignal.timeout(145000)});
 if(!response.ok)return {available:false};
 const result=funnelSafe(await response.json());
 if(result.available){if(cache.size>4)cache.clear();cache.set(key,result);}
 return result;
 }catch{return {available:false};}finally{pending.delete(key);}})();pending.set(key,task);return task;
}
