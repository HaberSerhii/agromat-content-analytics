import test from "node:test";
import assert from "node:assert/strict";
import {attributeOrder, transactionIndex, matchesMarketing, marketingOrderGroups, UNKNOWN_CHANNEL, ROZETKA_CHANNEL, UTM_CHANNEL} from "../src/lib/order-marketing-attribution.ts";
const transaction = {transactionId:"42",channel:"Cross-network",source:"google",medium:"cpc",campaign:"PMax"};

test("joins GA4 by exact internal website ID without changing saved UTM or order", () => {
 const order={id:42,order_num:1234,origin:{source:"site"},source:{utm_source:null,utm_campaign:null}};
 const result=attributeOrder(order,transactionIndex([transaction]));
 assert.equal(result.marketing.method,"ga4");
 assert.equal(result.marketing.campaign,"PMax");
 assert.equal(result.marketing.transactionId,"42");
 assert.equal(order.marketing,undefined);
 assert.equal(result.source,order.source);
 assert.equal(attributeOrder({...order,id:99,order_num:42},transactionIndex([transaction])).marketing.method,"unknown");
});

test("ambiguous transactions never select an arbitrary campaign; identical rows remain usable", () => {
 const conflicts=transactionIndex([transaction,{...transaction,campaign:"other"}]);
 const fallback=attributeOrder({id:42,source:{utm_source:"facebook",utm_campaign:"sale"}},conflicts);
 assert.equal(fallback.marketing.method,"utm");
 assert.equal(fallback.marketing.reason,"ambiguous");
 assert.equal(fallback.marketing.channel,UTM_CHANNEL);
 assert.equal(attributeOrder({id:42},transactionIndex([transaction,transaction])).marketing.method,"ga4");
 assert.equal(transactionIndex([{...transaction,transactionId:"(not set)"}]).size,0);
});

test("marketplace origin wins over accidental transaction ID collisions; unknown does not imply direct", () => {
 const index=transactionIndex([transaction]);
 const marketplace=attributeOrder({id:42,origin:{source:"rozetka"}},index);
 assert.equal(marketplace.marketing.method,"marketplace");
 assert.equal(marketplace.marketing.channel,ROZETKA_CHANNEL);
 assert.equal(attributeOrder({id:99},index).marketing.channel,UNKNOWN_CHANNEL);
 assert.equal(attributeOrder({id:42,origin:{source:"another-marketplace"}},index).marketing.method,"unknown");
});

test("attribution filters and complete-set campaign totals retain exact revenue and AOV", () => {
 const index=transactionIndex([transaction]);
 const orders=Array.from({length:70},()=>attributeOrder({id:42,totals:{cost:100}},index));
 const group=marketingOrderGroups(orders)[0];
 assert.deepEqual([group.orders,group.revenue,group.averageOrder],[70,7000,100]);
 assert.equal(matchesMarketing(orders[0],"value:google","value:PMax","Cross-network"),true);
 assert.equal(matchesMarketing(orders[0],"value:google","value:PMax","Paid Search"),false);
 assert.equal(matchesMarketing(orders[0],"value:google","value:PMax","Cross-network","cpm"),false);
 assert.equal(matchesMarketing(attributeOrder({id:99},index),"missing","missing",UNKNOWN_CHANNEL),true);
});
