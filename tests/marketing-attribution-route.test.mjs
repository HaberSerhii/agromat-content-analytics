import test from "node:test";
import assert from "node:assert/strict";
import {sourceLoader} from "./helpers/load-source.mjs";

function loadRoute({unavailable=false,authorized=true}={}) {
 const orders=Array.from({length:65},(_,i)=>({id:i+1,order_num:9000+i,date:"2026-10-02T12:00:00Z",origin:{source:"site"},totals:{cost:100},source:null,items:[],payment:null,status:"В обробці"}));
 orders.push({id:66,order_num:42,date:"2026-10-02T12:00:00Z",origin:{source:"rozetka"},totals:{cost:500},source:null,items:[],payment:null,status:"В обробці"});
 let ga4Calls=0;
 const GET=sourceLoader({globals:{process:{env:{AGROMAT_API_KEY:"test"}},fetch:async url=>{const page=Number(new URL(url).searchParams.get("page"));return {ok:true,json:async()=>({data:orders.slice((page-1)*50,page*50),meta:{total_pages:2}})};}},mocks:{
  "next/server":{NextResponse:{json:(body,options)=>({body,status:options?.status||200})}},
  "@/lib/dashboard-auth":{isDashboardRequest:()=>authorized},
  "@/lib/ga4-order-transactions":{readGa4OrderTransactions:async()=>{ga4Calls++;if(unavailable)throw Error("token=must-not-leak");return {rows:Array.from({length:60},(_,i)=>({transactionId:String(i+1),channel:"Paid Search",source:"google",medium:"cpc",campaign:"brand"})),fetchedAt:"2026-10-03T10:00:00Z",limited:false};}},
  "@/lib/server-result-cache":{peekServerResult:()=>null,getServerResult:async({load})=>({value:await load()})},
  "@/lib/products-store":{readAllLite:async()=>[]},
  "@/lib/sales-s3":{readSalesProductCategoryLookup:async()=>new Map(),readSalesWebshopReturnLookup:async()=>new Map(),readSalesWebshopManagerLookup:async()=>new Map()},
  "@/lib/promotion-price-position":{normalizePromotionPricePosition:()=>"all"},
  "@/lib/liqpay":{readOnlinePayments:async()=>({availability:"ready",payments:[]})},
 }})("@/app/api/sales/webshop-orders/route").GET;
 return {GET,ga4Calls:()=>ga4Calls};
}
const base="http://localhost/api/sales/webshop-orders?from=2026-10-01&to=2026-10-03";

test("GA4 filters actual orders, pagination, daily chart and campaign totals together",async()=>{
 const {GET}=loadRoute();
 const result=await GET({url:base+"&attribution=ga4&utm_campaign=value:brand&traffic_channel=Paid%20Search&page=2"});
 assert.equal(result.status,200);
 assert.equal(result.body.data.length,10);
 assert.equal(result.body.summary.total,60);
 assert.equal(result.body.daily[1].transactions,60);
 assert.equal(result.body.daily[1].revenue,6000);
 assert.equal(result.body.marketing.matched,60);
 assert.equal(result.body.marketing.groups[0].orders,60);
 assert.equal(result.body.marketing.groups[0].revenue,6000);
 assert.equal(result.body.data[0].source,null);
 assert.equal(result.body.data[0].marketing.source,"google");
});

test("coverage reconciles site, marketplace, and unmatched orders without disappearing rows",async()=>{
 const {GET}=loadRoute();const {body}=await GET({url:base+"&attribution=ga4"});
 assert.equal(body.summary.total,66);
 assert.deepEqual([body.marketing.matched,body.marketing.marketplace,body.marketing.unknown],[60,1,5]);
 assert.equal(body.marketing.groups.reduce((n,g)=>n+g.orders,0),66);
 assert.equal(body.marketing.groups.reduce((n,g)=>n+g.revenue,0),body.summary.revenue);
});

test("GA4 failure preserves orders and reports degraded attribution without leaking provider errors",async()=>{
 const {GET}=loadRoute({unavailable:true});const {body}=await GET({url:base+"&attribution=ga4"});
 assert.equal(body.summary.total,66);
 assert.equal(body.marketing.availability,"unavailable");
 assert.equal(body.marketing.unknown,65);
 assert.ok(!JSON.stringify(body).includes("token="));
});

test("legacy order registry never queries GA4; attribution requires dashboard access",async()=>{
 const route=loadRoute();const {body}=await route.GET({url:base});
 assert.equal(route.ga4Calls(),0);assert.equal(body.marketing,undefined);assert.equal(body.summary.total,66);
 const protectedRoute=loadRoute({authorized:false});
 assert.equal((await protectedRoute.GET({url:base+"&attribution=ga4"})).status,401);
 assert.equal(protectedRoute.ga4Calls(),0);
});
