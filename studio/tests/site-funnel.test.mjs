import test from 'node:test';
import assert from 'node:assert/strict';
import {funnelSafe,readSiteFunnel} from '../site-funnel.mjs';
import {renderSiteFunnel,funnelTooltipData} from '../public/site-funnel.mjs';
const p=(start,orders)=>({available:true,from:'2026-11-09',to:'2026-11-15',stages:[{key:'landing',users:start},{key:'purchase',users:orders}],secret:'hidden'});
test('funnel projection exposes only known aggregate stages and comparison periods',()=>{
 const safe=funnelSafe({comparisons:{all:{current:p(34446,188),previous:p(45195,244),yearAgo:p(31325,141)}},credentials:'hidden'});
 assert.equal(safe.current.stages[0].value,34446);
 assert.equal(safe.current.stages[1].value,null);
 assert.doesNotMatch(JSON.stringify(safe),/hidden|secret|credentials/);
 const html=renderSiteFunnel(safe,'week');
 assert.match(html,/0,540%/);assert.match(html,/0,546%/);
 assert.match(html,/-56 зам/);assert.match(html,/До попереднього тижня/);
 assert.match(renderSiteFunnel(safe,'month'),/До попереднього місяця/);
});
test('missing funnel data remains explicitly unavailable',()=>{
 assert.deepEqual(funnelSafe({}),{available:false});
 assert.match(renderSiteFunnel({available:false}),/тимчасово недоступні/);
});
test('transition colors compare stage conversion rates, not raw counts',()=>{
 const period=values=>({available:true,from:'2026-10-01',to:'2026-10-31',stages:['landing','view_item','cart','begin_checkout','purchase'].map((key,i)=>({key,value:values[i]}))});
 const html=renderSiteFunnel({available:true,current:period([100,60,12,6,3]),previous:period([200,100,30,15,6])});
 assert.match(html,/funnel-step up">60%/);
 assert.match(html,/funnel-step down">20%/);
 assert.match(html,/funnel-step neutral">50%/);
 assert.match(html,/funnel-step up">50%/);
});

test('hover details compare the same stage ratio and preserve missing year data',()=>{
 const period=(from,start,view,orders)=>({from,to:from,stages:[{key:'landing',value:start},{key:'view_item',value:view},{key:'purchase',value:orders}]});
 const source={available:true,current:period('2026-11-09',100,60,4),previous:period('2026-11-02',200,100,5),yearAgo:period('2025-11-10',80,32,2)};
 const tip=funnelTooltipData(source,'transition',1);
 assert.deepEqual(tip.rows.map(r=>r.value),['60,000%','50,000%','40,000%']);
 assert.equal(tip.rows[2].dates,'10.11.2025 — 10.11.2025');
 assert.equal(tip.comparisons[1].difference,'+20,000 в.п.');
 assert.equal(funnelTooltipData(source,'purchase').comparisons[0].difference,'-1 зам.');
 assert.equal(funnelTooltipData({...source,yearAgo:null},'cr').rows[2].value,'—');
 assert.doesNotMatch(renderSiteFunnel(source),/Порівняння та деталі|Як читати воронку/);
});

test('each funnel bar has period counts and the selected comparison',()=>{
 const period=(from,to,count)=>({range:{from,to},stages:[{key:'purchase',value:count}]});
 const source={available:true,selection:true,comparisonMode:'mom',
   current:period('2026-11-01','2026-11-17',627),previous:period('2026-10-01','2026-10-17',352)};
 const tip=funnelTooltipData(source,'stage',4);
 assert.deepEqual(tip.rows.map(({value})=>value),['627','352']);
 assert.equal(tip.rows[1].dates,'01.10.2026 — 17.10.2026');
 assert.deepEqual(tip.comparisons,[{label:'MOM',relative:'+78,13%',difference:'+275 зам.'}]);
 const html=renderSiteFunnel(source);
 assert.match(html,/aria-label="Замовлення: 627" data-funnel-tip=/);
 assert.doesNotMatch(html,/<title>/);
 assert.equal(funnelTooltipData({...source,previous:{...source.previous,available:false}},'stage',4).rows[1].value,'—');
});

test('funnel adapter supplies the required fixed site URL to the source',async()=>{
 const original=globalThis.fetch;
 let request;
 globalThis.fetch=async url=>{request=new URL(url);return {ok:true,json:async()=>({comparisons:{all:{current:p(100,2),previous:p(100,1),yearAgo:p(100,1)}}})}};
 try{
  assert.equal((await readSiteFunnel('week','http://127.0.0.1:3000','')).available,true);
  assert.equal(request.searchParams.get('url'),'https://www.agromat.ua/');
  assert.equal(request.searchParams.get('period'),'week');
 }finally{globalThis.fetch=original;}
});
