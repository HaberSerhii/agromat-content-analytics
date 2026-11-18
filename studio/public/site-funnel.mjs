const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const n=v=>v==null?'—':new Intl.NumberFormat('uk-UA',{maximumFractionDigits:0}).format(v);
const pct=v=>v==null?'—':new Intl.NumberFormat('uk-UA',{maximumFractionDigits:2}).format(v)+'%';
const crPct=v=>v==null?'—':new Intl.NumberFormat('uk-UA',{minimumFractionDigits:3,maximumFractionDigits:3}).format(v)+'%';
const value=(p,key)=>p?.stages?.find(s=>s.key===key)?.value??null;
const cr=p=>value(p,'landing')>0&&value(p,'purchase')!=null?value(p,'purchase')/value(p,'landing')*100:null;
const dates=p=>{const range=p?.range||p;return range?.from&&range?.to?`${range.from.split('-').reverse().join('.')} — ${range.to.split('-').reverse().join('.')}`:'—';};
const delta=(a,b)=>a!=null&&b>0?(a/b-1)*100:null;
export function renderSiteFunnel(source,mode='week',options={}){
 const controls=source?.selection||options.selection?'':`<div class="bo-segments" role="group" aria-label="Період воронки">${[['week','Тиждень'],['month','Місяць']].map(([key,label])=>`<button data-funnel-mode="${key}" aria-pressed="${mode===key}">${label}</button>`).join('')}</div>`;
 const heading=`<header><div><h2>Воронка сайту</h2><p>Трафік → замовлення</p></div>${controls}</header>`;
 if(!source?.available)return `<section id="bo-funnel" class="bo-card bo-funnel">${heading}<div class="bo-empty">${esc(options.notice||source?.current?.notice||(source==null?'Завантажуємо воронку…':'Дані воронки тимчасово недоступні.'))}</div></section>`;
 const current=source.current,previous=source.previous;
 const keys=['landing','view_item','cart','begin_checkout','purchase'];
 const labels=['Старт','Перегляд товару','Кошик','Чекаут','Замовлення'];
 const max=Math.max(...keys.map(key=>value(current,key)||0),1);
 const height=v=>v==null?0:Math.max(10,200*Math.sqrt(v/max));
 const transition=(p,i)=>i>0&&value(p,keys[i-1])>0&&value(p,keys[i])!=null?value(p,keys[i])/value(p,keys[i-1])*100:null;
 const connectors=keys.slice(0,-1).map((key,i)=>`<polygon points="${102+i*108},${240-height(value(current,key))} ${134+i*108},${240-height(value(current,keys[i+1]))} ${134+i*108},240 ${102+i*108},240" fill="#eeeaff"/>`).join('');
 const bands=connectors+keys.map((key,i)=>{
   const v=value(current,key),h=height(v),now=transition(current,i),before=transition(previous,i);
   const tone=now==null||before==null||Math.abs(now-before)<1e-9?'neutral':now>before?'up':'down';
   return `<g><rect x="${26+i*108}" y="${240-h}" width="76" height="${h}" rx="12" fill="${['#533afd','#7157ff','#8d7afb','#a391fc','#baaefa'][i]}"/><text x="${64+i*108}" y="${228-h}" text-anchor="middle" class="funnel-value">${n(v)}</text><text x="${64+i*108}" y="292" text-anchor="middle" class="funnel-stage-name">${['Старт','Товар','Кошик','Чекаут','Замовл.'][i]}</text>${i?`<g tabindex="0" role="img" aria-label="${labels[i-1]} → ${labels[i]}: ${pct(now)}" data-funnel-tip="${esc(JSON.stringify(funnelTooltipData(source,'transition',i,mode)))}"><rect x="${16+i*108-35}" y="246" width="70" height="30" fill="transparent"/><text x="${16+i*108}" y="265" text-anchor="middle" class="funnel-step ${tone}">${pct(now)}</text></g>`:''}<title>${labels[i]}: ${n(v)}; попередній період: ${n(value(previous,key))}</title></g>`;
 }).join('');
 const signed=v=>v==null?'Немає бази':(v>=0?'+':'')+pct(v);
 return `<section id="bo-funnel" class="bo-card bo-funnel">${heading}<div class="bo-funnel-layout"><div><p class="bo-funnel-date">${dates(current)}</p><svg viewBox="0 0 570 310" role="img" aria-label="Воронка сайту: переходи порівняно з попереднім періодом">${bands}</svg></div><div class="bo-funnel-quick">${[['CR',cr(current),cr(previous),crPct],['Замовлення',value(current,'purchase'),value(previous,'purchase'),n]].map(([label,a,b,format])=>{const d=delta(a,b),meta=funnelTooltipData(source,label==='CR'?'cr':'purchase',0,mode);return `<button class="bo-funnel-hover-metric" data-funnel-tip="${esc(JSON.stringify(meta))}" type="button"><small>${label}</small><strong>${format(a)}</strong><span class="${d==null?'':d>=0?'up':'down'}">${signed(d)}</span><em>${format(b)}</em></button>`}).join('')}</div></div><div id="funnel-hover-tooltip" class="bo-quarter-tooltip bo-funnel-tooltip" role="tooltip" hidden></div></section>`;
}
export function funnelTooltipData(source,kind,index=0,mode='week'){
 const keys=['landing','view_item','cart','begin_checkout','purchase'],labels=['Старт','Товар','Кошик','Чекаут','Замовлення'];
 const rate=p=>kind==='cr'?cr(p):kind==='purchase'?value(p,'purchase'):value(p,keys[index-1])>0&&value(p,keys[index])!=null?value(p,keys[index])/value(p,keys[index-1])*100:null;
 const format=kind==='purchase'?n:crPct;
 const current=rate(source.current),previous=rate(source.previous),last=rate(source.yearAgo);
 const difference=baseline=>current==null||baseline==null?'Немає бази':kind==='purchase'?(current-baseline>=0?'+':'')+n(current-baseline)+' зам.':(current-baseline>=0?'+':'')+crPct(current-baseline).replace('%',' в.п.');
 const relative=baseline=>{const d=delta(current,baseline);return d==null?'Немає бази':(d>=0?'+':'')+pct(d)};
 if(source.selection)return {title:kind==='cr'?'Конверсія у замовлення':kind==='purchase'?'Замовлення':`${labels[index-1]} → ${labels[index]}`,rows:[['Поточний період',source.current,current],[source.comparisonMode==='wow'?'Попередній тиждень':source.comparisonMode==='mom'?'Попередній місяць':'Ті самі дати торік',source.previous,previous]].map(([label,period,v])=>({label,dates:dates(period),value:format(v),counts:kind==='purchase'?'':kind==='cr'?`${n(value(period,'purchase'))} / ${n(value(period,'landing'))}`:`${n(value(period,keys[index]))} / ${n(value(period,keys[index-1]))}`})),comparisons:[{label:source.comparisonMode?.toUpperCase(),relative:relative(previous),difference:difference(previous)}],note:'Старт та етапи до замовлення — унікальні користувачі України. Замовлення — унікальні транзакції purchase або payment_unpaid з усіх країн.'};
 return {title:kind==='cr'?'Конверсія у замовлення':kind==='purchase'?'Замовлення':`${labels[index-1]} → ${labels[index]}`,rows:[['Поточний період',source.current,current],['Попередній період',source.previous,previous],['Той самий період торік',source.yearAgo,last]].map(([label,period,v])=>({label,dates:dates(period),value:format(v),counts:kind==='purchase'?'':kind==='cr'?`${n(value(period,'purchase'))} / ${n(value(period,'landing'))}`:`${n(value(period,keys[index]))} / ${n(value(period,keys[index-1]))}`})),comparisons:[{label:mode==='week'?'До попереднього тижня':'До попереднього місяця',relative:relative(previous),difference:difference(previous)},{label:'До того самого періоду торік',relative:relative(last),difference:difference(last)}],note:kind==='cr'?'CR = замовлення / користувачі на старті. До чекаута — користувачі України; замовлення — унікальні транзакції з усіх країн.':kind==='purchase'?'Унікальні транзакції purchase / payment_unpaid · усі країни.':index===4?'Перехід: замовлення з усіх країн / користувачі України на чекауті.':'Перехід між етапами · унікальні користувачі України. Шкала стовпців — коренева.'};
}
export function bindFunnelTooltips(root=document){
 const tip=root.querySelector('#funnel-hover-tooltip');if(!tip)return;
 root.querySelectorAll('[data-funnel-tip]').forEach(target=>{
  const meta=JSON.parse(target.dataset.funnelTip);
  const hide=()=>{tip.hidden=true;target.removeAttribute('aria-describedby');};
  const show=event=>{
   tip.innerHTML=`<div class="bo-funnel-tip-title">${esc(meta.title)}</div>${meta.rows.map(row=>`<div class="bo-funnel-tip-row"><div>${esc(row.label)}<small>${esc(row.dates)}</small></div><div><b>${esc(row.value)}</b>${row.counts?`<small>${esc(row.counts)}</small>`:''}</div></div>`).join('')}<div class="bo-funnel-tip-comparisons">${meta.comparisons.map(row=>`<div><span>${esc(row.label)}</span><b>${esc(row.relative)}<small>${esc(row.difference)}</small></b></div>`).join('')}</div><p>${esc(meta.note)}</p>`;
   tip.hidden=false;target.setAttribute('aria-describedby',tip.id);
   const r=target.getBoundingClientRect(),x=event?.clientX??r.right,y=event?.clientY??r.top;
   tip.style.left=Math.max(8,Math.min(x+12,innerWidth-tip.offsetWidth-8))+'px';
   tip.style.top=Math.max(8,Math.min(y+12,innerHeight-tip.offsetHeight-8))+'px';
  };
  target.addEventListener('pointerenter',show);target.addEventListener('pointermove',show);target.addEventListener('pointerleave',hide);target.addEventListener('focus',()=>show());target.addEventListener('blur',hide);target.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});
 });
}
