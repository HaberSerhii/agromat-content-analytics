import test from "node:test";
import assert from "node:assert/strict";
import {sourceLoader} from "./helpers/load-source.mjs";

test("transaction loader reads purchase-only session attribution across every page",async()=>{
 const calls=[];
 const row=id=>({dimensionValues:[String(id),"Paid Search","google","cpc","brand"].map(value=>({value})),metricValues:[{value:"1"}]});
 const {readGa4OrderTransactions}=sourceLoader({globals:{process:{env:{GA4_PROPERTY_ID:"123"}}},mocks:{
  "google-auth-library":{GoogleAuth:class {async getClient(){return {request:async request=>{calls.push(request);return {data:{rows:calls.length===1?[row(1),row(2)]:[row(3)],rowCount:3,metadata:{subjectToThresholding:true}}};}};}}},
  "@/lib/server-result-cache":{getServerResult:async({load})=>({value:await load()})},
 }})("@/lib/ga4-order-transactions");
 const result=await readGa4OrderTransactions("2026-10-01","2026-10-03");
 assert.deepEqual(calls.map(c=>c.data.offset),["0","2"]);
 assert.equal(calls[0].data.dimensionFilter.filter.stringFilter.value,"purchase");
 assert.equal(calls[0].data.dimensions[0].name,"transactionId");
 assert.equal(result.rows.length,3);assert.equal(result.limited,true);
 assert.equal(result.rows[2].transactionId,"3");
});

test("a failed later GA4 page rejects the whole attribution load instead of publishing partial matches",async()=>{
 let calls=0;
 const {readGa4OrderTransactions}=sourceLoader({globals:{process:{env:{GA4_PROPERTY_ID:"123"}}},mocks:{
  "google-auth-library":{GoogleAuth:class {async getClient(){return {request:async()=>{calls++;if(calls===2)throw Error("quota");return {data:{rows:[{dimensionValues:[{value:"1"}]}],rowCount:2}};}};}}},
  "@/lib/server-result-cache":{getServerResult:async({load})=>({value:await load()})},
 }})("@/lib/ga4-order-transactions");
 await assert.rejects(()=>readGa4OrderTransactions("2026-10-01","2026-10-03"));
 assert.equal(calls,2);
});
