import test from 'node:test';
import assert from 'node:assert/strict';
import {assortmentImpact} from '../assortment-source.mjs';

const range = {from:'2026-11-01',to:'2026-11-19'};
const previous = {from:'2026-10-01',to:'2026-10-19'};
const sale = (shippedDate, code, revenue, extra={}) => ({shippedDate,state:'Повністю відвантажено',docsSum:revenue,returnSum:0,
  items:[{code,revenue,qty:1}],goodsCount:1,returnGoodsCodes:[],returnRowSums:[],...extra});

test('assortment includes confirmed new SKUs and deducts the lost sales of archived SKUs once',()=>{
  const catalogue = {groups:new Map([['1','new'],['2','removed'],['3','new']]),coverage:{observed:19,days:19,matched:3,candidates:3}};
  const rows = [sale('2026-09-28','3',10),sale('2026-10-10','2',120),sale('2026-11-14','1',350),
    sale('2026-11-14','2',20),sale('2026-11-15','3',99),sale('2026-11-16','1',250,{marketplace:true})];
  const report = assortmentImpact(catalogue,rows,range,previous,row=>!row.marketplace,()=>false);
  assert.equal(report.added,1);
  assert.equal(report.sold,1);
  assert.equal(report.newRevenue,350);
  assert.equal(report.removedPrevious,120);
  assert.equal(report.removedRevenue,20);
  assert.equal(report.effect,230);
  const bothChannels = assortmentImpact(catalogue,rows,range,previous,()=>true,()=>false,row=>!row.marketplace);
  assert.equal(bothChannels.newRevenue,600);
  assert.equal(bothChannels.newSiteRevenue,350);
});
