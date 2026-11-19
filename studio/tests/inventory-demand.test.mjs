import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {addDays} from '../public/overview-filters.mjs';
import {inventoryPrevious,inventorySelection} from '../public/inventory-demand-filters.mjs';
import {compareInventory,inventoryAnalysis,inventoryDetail,observation,periodItem} from '../inventory-demand.mjs';
import {loadInventoryData,readInventorySales} from '../inventory-demand-source.mjs';

const today = '2026-11-19';
const select = filters=>inventorySelection({from:'2026-11-12',to:'2026-11-18',...filters},today);

function fixture() {
  const dates = Array.from({length:125},(_,i)=>addDays(today,i-125));
  const index = new Map(dates.map((date,i)=>[date,i]));
  const weeks = dates.map(date=>Math.floor((Date.parse(date)+3*86400000)/604800000));
  const data = {dates,index,weeks,items:new Map(),statusCoverage:new Uint8Array(dates.length).fill(1),
    salesCoverage:new Uint8Array(dates.length).fill(1),fullIndex:new Int16Array(dates.length).fill(-1),
    stockWatch:{available:true,rows:[]}};
  function product(code,{category='Плитка',brand='AG',amount=100,units=2,out=[],unknown=[],saleThrough='2026-11-18',
    cost=amount*.6}={}) {
    const item = {code,name:'Товар '+code,category,subcategory:category,brand,states:new Uint8Array(dates.length),
      sales:new Map(),firstSeen:dates[0]};
    for (const [i,date] of dates.entries()) {
      if (unknown.includes(date)) continue;
      if (out.includes(date)) item.states[i]=observation(1,false,false);
      else {
        item.states[i]=observation(3,false,false);
        if (date<=saleThrough && amount>0) item.sales.set(i,{revenue:amount,units,cost,coveredRevenue:cost>0?amount:0});
      }
    }
    data.items.set(code,item);
    return item;
  }
  return {data,product};
}

test('sale velocity uses confirmed orderable days, and missing snapshots cannot become lost days',()=>{
  const {data,product}=fixture();
  const item=product('123',{out:['2026-11-12','2026-11-13','2026-11-16'],unknown:['2026-11-15','2026-11-18']});
  item.sales.set(data.index.get('2026-11-13'),{revenue:9000,units:80,cost:200,coveredRevenue:9000});
  const row=periodItem(data,item,select());
  assert.equal(row.dailyRevenue,100);
  assert.equal(row.dailyUnits,2);
  assert.equal(row.outDays,3);
  assert.equal(row.loss,300);
  assert.equal(row.margin,120);
  assert.equal(row.status,'unknown');
  assert.equal(row.lastLoss,'2026-11-12','a gap cannot establish a transition');
  assert.equal(row.confidence,'medium','window coverage is below 80%');
  assert.equal(row.backtest.error,0);
  const detail=inventoryDetail(data,item,select());
  assert.deepEqual(detail.outages,[{from:'2026-11-12',to:'2026-11-13',days:2},{from:'2026-11-16',to:'2026-11-16',days:1}]);
  assert.equal(detail.days.find(day=>day.date==='2026-11-15').loss,null);
  assert.equal(detail.days.find(day=>day.date==='2026-11-13').revenue,9000);
});

test('outage continuing from the previous window trains before the outage started',()=>{
  const {data,product}=fixture();
  const out=Array.from({length:40},(_,i)=>addDays(today,i-40));
  const item=product('124',{out});
  assert.equal(periodItem(data,item,select()).sampleDays,70);
  assert.equal(periodItem(data,item,select()).loss,700);
  const previous=inventoryPrevious(select());
  assert.equal(periodItem(data,item,previous).loss,700);
});

test('separate outages use their own past data and partial forecasts cover only eligible episodes',()=>{
  const {data,product}=fixture();
  const item=product('125',{out:['2026-11-12','2026-11-18']});
  for (const [i,date] of data.dates.entries()) {
    if (date<'2026-10-24') item.states[i]=0;
  }
  const row=periodItem(data,item,select());
  assert.equal(row.outDays,2);
  assert.equal(row.modeledDays,1);
  assert.equal(row.marginDays,1);
  assert.equal(row.loss,100);
  assert.equal(row.margin,40);
  const detail=inventoryDetail(data,item,select());
  assert.equal(detail.days[0].loss,null);
  assert.equal(detail.days.at(-1).loss,100);
});

test('short sales history and unknown cost stay nullable and high variation lowers confidence',()=>{
  const {data,product}=fixture();
  const short=product('1',{saleThrough:'2026-10-15',out:['2026-11-18']});
  for (const index of short.sales.keys()) if (data.dates[index]<'2026-10-14') short.sales.delete(index);
  const missing=product('2',{cost:0,out:['2026-11-18']});
  const irregular=product('3',{out:['2026-11-18']});
  irregular.sales.get(data.index.get('2026-11-11')).revenue=20000;
  const a=periodItem(data,short,select()), b=periodItem(data,missing,select()), c=periodItem(data,irregular,select());
  assert.equal(a.loss,null);
  assert.equal(a.confidence,null);
  assert.ok(a.flags.includes('history'));
  assert.equal(b.loss,100);
  assert.equal(b.margin,null);
  assert.ok(b.flags.includes('margin'));
  assert.equal(c.confidence,'low');
  assert.ok(c.flags.includes('concentration'));
});

test('promo history can be excluded from a supported baseline and affects confidence',()=>{
  const {data,product}=fixture();
  const item=product('1',{out:['2026-11-18']});
  for (const date of ['2026-10-10','2026-10-11','2026-10-12']) {
    const index=data.index.get(date);
    item.states[index]=observation(5,false,true);
    item.sales.get(index).revenue=10000;
  }
  const row=periodItem(data,item,select());
  assert.equal(row.dailyRevenue,100);
  assert.equal(row.loss,100);
  assert.ok(row.flags.includes('promo'));
  assert.equal(row.confidence,'low');
});

test('shared filters constrain ranked losses, charts, matrix, and table without changing category demand thresholds',()=>{
  const {data,product}=fixture();
  product('high',{units:10,brand:'A',out:['2026-11-17','2026-11-18']});
  product('low',{units:1,brand:'A'});
  product('outside',{category:'Інше',brand:'B',out:['2026-11-18'],amount:200,units:1});
  const query=select({category:'Плитка',brand:'A',quadrant:'priority'});
  const result=inventoryAnalysis(data,query);
  assert.equal(result.current.loss,200);
  assert.equal(result.current.confirmed,1);
  assert.equal(result.prior.loss,null);
  assert.deepEqual(result.categories,[['Плитка',200]]);
  assert.deepEqual(result.brands,[['A',200]]);
  assert.equal(result.matrix.priority,1);
  assert.deepEqual(result.table.map(row=>row.code),['high']);
  assert.equal(result.chart.reduce((sum,day)=>sum+(day.loss ?? 0),0),result.current.loss);
  const rows=[{code:'0',loss:null},{code:'1',loss:0},{code:'2',loss:200}];
  assert.deepEqual(rows.sort((a,b)=>compareInventory(a,b,query)).map(row=>row.code),['2','1','0']);
});

test('replenishment ranks a selected day by margin and keeps historical sales separate from estimates',()=>{
  const {data,product}=fixture();
  const out=['2026-11-17','2026-11-18'];
  product('1',{brand:'A',amount:100,cost:85,out});
  product('2',{brand:'A',amount:90,cost:40,out});
  product('3',{brand:'A',amount:150,cost:0,out:['2026-11-18']});
  const short=product('4',{brand:'A',amount:70,out});
  for (const [i,date] of data.dates.entries()) if (date<'2026-11-13') short.states[i]=0;
  product('5',{brand:'B',amount:1000,out});
  const result=inventoryAnalysis(data,select({brand:'A',view:'alerts'}));
  assert.equal(result.table.length,0,'stock alerts do not limit the priority report');
  const day=result.priorityFor('2026-11-18');
  assert.equal(day.out,4);
  assert.equal(day.modeled,3);
  assert.equal(day.marginSku,2);
  assert.equal(day.loss,340);
  assert.equal(day.expected,day.actual+day.loss);
  assert.deepEqual(day.rows.map(({code,outDays,margin})=>[code,outDays,margin]),[
    ['2',2,50],['1',2,15],['3',1,null],
  ]);
  assert.deepEqual(day.evidence.map(({code,revenue,saleDays})=>[code,revenue,saleDays]),[['4',280,4]]);
  assert.deepEqual(result.priorityFor('2026-11-17').rows.map(({code})=>code),['2','1']);
  assert.equal(result.priorityFor('2026-11-17').loss,190);
});

test('ERP imports website shipments once, with line costs only where they can be attributed',()=>{
  const {data,product}=fixture();
  const item=product('123',{amount:0});
  const record={docsRef:'1',shippedDate:'2026-11-18',state:'Повністю відвантажено',webshopId:'A1',docsSum:100,
    returnSum:0,returnGoodsCodes:[],returnRowSums:[],items:[{code:'123',name:'Товар',revenue:100,qty:2,ownCost:55}]};
  readInventorySales(data,{rows:[record,record,{...record,docsRef:'2',webshopId:'marketplace'},
    {...record,docsRef:'3',shippedDate:'2026-11-17',returnSum:25,returnGoodsCodes:['123'],returnRowSums:[25]}]},
  new Set(['marketplace']),'2026-11-18');
  assert.deepEqual(item.sales.get(data.index.get('2026-11-18')),{revenue:100,units:2,cost:55,coveredRevenue:100});
  assert.deepEqual(item.sales.get(data.index.get('2026-11-17')),{revenue:75,units:2,cost:0,coveredRevenue:0});
});

test('source reads compact status history, full snapshots add prices, and absent days stay unknown',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'studio-inventory-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.mkdir(dir+'/availability-daily');
  const write=(name,value)=>fs.writeFile(dir+'/'+name,gzipSync(JSON.stringify(value)));
  const item={id:1,code:123,name:'Товар',brand:'A',categoryName:'Плитка',statusId:1,stockQty:12,price:800,currency:'UAH',isOnSale:true};
  await write('catalog.gz',{products:[item]});
  await write('2026-11-18.json.gz',{products:[item]});
  await write('availability-daily/2026-11-16.json.gz',{version:1,products:[[1,0,0,3,0]],categories:[['1','Плитка']],brands:[['1','A']]});
  const data=await loadInventoryData(select(),async()=>null,async()=>null,{dir,catalogue:dir+'/catalog.gz',readViews:async()=>null});
  const detail=inventoryDetail(data,data.items.get('123'),select());
  assert.deepEqual(detail.days.slice(-3).map(({status,price,promo})=>[status,price,promo]),[
    ['in',null,'no'],['unknown',null,'unknown'],['out',800,'yes'],
  ]);
  assert.equal(detail.row.outDays,1);
  assert.equal(detail.row.lastLoss,null);
  assert.equal(detail.row.loss,null);
  const filtered=inventoryAnalysis(data,select({promo:'yes',price:'low',status:'out'}));
  assert.equal(filtered.current.out,1);
  assert.equal(filtered.current.loss,null);
  assert.equal(filtered.prior.out,null);
  assert.equal(filtered.coverage.sales,0);
  const long = select({from:'2026-08-21'});
  const longData = await loadInventoryData(long,async()=>null,async()=>null,{
    dir,catalogue:dir+'/catalog.gz',readViews:async()=>null,
  });
  const report = inventoryAnalysis(longData,long);
  assert.equal(report.chart.length,90);
  assert.equal(report.coverage.current,2);
  assert.equal(report.coverage.previous,0);
  assert.equal(report.prior.out,null);
  const noStatus=report.priorityFor('2026-11-17');
  assert.equal(noStatus.statusAvailable,false);
  assert.equal(noStatus.out,null);
  assert.equal(noStatus.loss,null);
  assert.deepEqual(noStatus.rows,[]);
});
