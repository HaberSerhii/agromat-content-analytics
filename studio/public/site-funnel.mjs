const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const n=v=>v==null?'—':new Intl.NumberFormat('uk-UA',{maximumFractionDigits:0}).format(v);
const pct=v=>v==null?'—':new Intl.NumberFormat('uk-UA',{maximumFractionDigits:2}).format(v)+'%';
const crPct=v=>v==null?'—':new Intl.NumberFormat('uk-UA',{minimumFractionDigits:3,maximumFractionDigits:3}).format(v)+'%';
const value=(p,key)=>p?.stages?.find(s=>s.key===key)?.value??null;
const cr=p=>value(p,'landing')>0&&value(p,'purchase')!=null?value(p,'purchase')/value(p,'landing')*100:null;
const dates=p=>{const range=p?.range||p;return range?.from&&range?.to?`${range.from.split('-').reverse().join('.')} — ${range.to.split('-').reverse().join('.')}`:'—';};
const delta=(a,b)=>a!=null&&b>0?(a/b-1)*100:null;
const stages = ['landing','view_item','cart','begin_checkout','purchase'];
const stageNames = ['Старт','Перегляд товару','Кошик','Чекаут','Замовлення'];
const stageRate = (period,index) => {
  const from = value(period,stages[index-1]), to = value(period,stages[index]);
  return from > 0 && to != null ? to / from * 100 : null;
};
export function renderSiteFunnel(source,mode='week',options={}){
 const controls=source?.selection||options.selection?'':`<div class="bo-segments" role="group" aria-label="Період воронки">${[['week','Тиждень'],['month','Місяць']].map(([key,label])=>`<button data-funnel-mode="${key}" aria-pressed="${mode===key}">${label}</button>`).join('')}</div>`;
 const heading=`<header><div><h2>Воронка сайту</h2><p>Трафік → замовлення</p></div>${controls}</header>`;
 if(!source?.available)return `<section id="bo-funnel" class="bo-card bo-funnel">${heading}<div class="bo-empty">${esc(options.notice||source?.current?.notice||(source==null?'Завантажуємо воронку…':'Дані воронки тимчасово недоступні.'))}</div></section>`;
 const current=source.current,previous=source.previous;
 const keys=stages, labels=stageNames;
 const max=Math.max(...keys.map(key=>value(current,key)||0),1);
 const height=v=>v==null?0:Math.max(10,200*Math.sqrt(v/max));
 const connectors=keys.slice(0,-1).map((key,i)=>`<polygon points="${102+i*108},${240-height(value(current,key))} ${134+i*108},${240-height(value(current,keys[i+1]))} ${134+i*108},240 ${102+i*108},240" fill="#eeeaff"/>`).join('');
 const bands=connectors+keys.map((key,i)=>{
   const v=value(current,key),h=height(v),now=stageRate(current,i),before=stageRate(previous,i);
   const tone=now==null||before==null||Math.abs(now-before)<1e-9?'neutral':now>before?'up':'down';
   const stageTip = esc(JSON.stringify(funnelTooltipData(source,'stage',i,mode)));
   return `<g tabindex="0" role="img" aria-label="${labels[i]}: ${n(v)}" data-funnel-tip="${stageTip}"><rect x="${26+i*108}" y="${240-h}" width="76" height="${h}" rx="12" fill="${['#533afd','#7157ff','#8d7afb','#a391fc','#baaefa'][i]}"/><text x="${64+i*108}" y="${228-h}" text-anchor="middle" class="funnel-value">${n(v)}</text><text x="${64+i*108}" y="292" text-anchor="middle" class="funnel-stage-name">${['Старт','Товар','Кошик','Чекаут','Замовл.'][i]}</text></g>${i?`<g tabindex="0" role="img" aria-label="${labels[i-1]} → ${labels[i]}: ${pct(now)}" data-funnel-tip="${esc(JSON.stringify(funnelTooltipData(source,'transition',i,mode)))}"><rect x="${16+i*108-35}" y="246" width="70" height="30" fill="transparent"/><text x="${16+i*108}" y="265" text-anchor="middle" class="funnel-step ${tone}">${pct(now)}</text></g>`:''}`;
 }).join('');
 const signed=v=>v==null?'Немає бази':(v>=0?'+':'')+pct(v);
 return `<section id="bo-funnel" class="bo-card bo-funnel">${heading}<div class="bo-funnel-layout"><div><p class="bo-funnel-date">${dates(current)}</p><svg viewBox="0 0 570 310" role="img" aria-label="Воронка сайту: переходи порівняно з попереднім періодом">${bands}</svg></div><div class="bo-funnel-quick">${[['CR',cr(current),cr(previous),crPct],['Замовлення',value(current,'purchase'),value(previous,'purchase'),n]].map(([label,a,b,format])=>{const d=delta(a,b),meta=funnelTooltipData(source,label==='CR'?'cr':'purchase',0,mode);return `<button class="bo-funnel-hover-metric" data-funnel-tip="${esc(JSON.stringify(meta))}" type="button"><small>${label}</small><strong>${format(a)}</strong><span class="${d==null?'':d>=0?'up':'down'}">${signed(d)}</span><em>${format(b)}</em></button>`}).join('')}</div></div><div id="funnel-hover-tooltip" class="bo-quarter-tooltip bo-funnel-tooltip" role="tooltip" hidden></div></section>`;
}
export function funnelTooltipData(source,kind,index=0,mode='week'){
 const isCount = kind === 'stage' || kind === 'purchase';
 const isOrder = kind === 'purchase' || (kind === 'stage' && stages[index] === 'purchase');
 const title = kind === 'cr' ? 'Конверсія у замовлення' : isOrder ? 'Замовлення'
   : kind === 'stage' ? stageNames[index] : `${stageNames[index-1]} → ${stageNames[index]}`;
 const measure = period => {
   if (period?.available === false) return null;
   if (kind === 'cr') return cr(period);
   if (isCount) return value(period,isOrder?'purchase':stages[index]);
   return stageRate(period,index);
 };
 const current = measure(source.current);
 const format = isCount ? n : crPct;
 const row = (label,period) => {
   const measured = measure(period);
   const counts = isCount || measured == null ? '' : kind === 'cr'
     ? `${n(value(period,'purchase'))} / ${n(value(period,'landing'))}`
     : `${n(value(period,stages[index]))} / ${n(value(period,stages[index-1]))}`;
   return {label, dates:dates(period), value:format(measured), counts};
 };
 const comparison = (label,period) => {
   const prior = measure(period);
   const change = delta(current,prior);
   let difference = 'Немає бази';
   if (current != null && prior != null) {
     const gap = current - prior;
     const unit = isOrder ? ' зам.' : ' корист.';
     difference = (gap >= 0 ? '+' : '') + (isCount ? n(gap) + unit : crPct(gap).replace('%',' в.п.'));
   }
   return {label, relative:change == null ? 'Немає бази' : (change >= 0 ? '+' : '') + pct(change), difference};
 };
 const labels = {wow:'Попередній тиждень',mom:'Попередній місяць',yoy:'Ті самі дати торік'};
 const previousLabel = source.selection ? labels[source.comparisonMode] || 'Попередній період' : 'Попередній період';
 const rows = [row('Поточний період',source.current),row(previousLabel,source.previous)];
 const comparisons = [comparison(source.selection ? source.comparisonMode?.toUpperCase() || previousLabel
   : mode === 'week' ? 'До попереднього тижня' : 'До попереднього місяця',source.previous)];
 if (!source.selection) {
   rows.push(row('Той самий період торік',source.yearAgo));
   comparisons.push(comparison('До того самого періоду торік',source.yearAgo));
 }
 const note = isCount
   ? isOrder ? 'Унікальні транзакції purchase або payment_unpaid з усіх країн.' : 'Унікальні користувачі України.'
   : 'Старт та етапи до замовлення — унікальні користувачі України. Замовлення — унікальні транзакції purchase або payment_unpaid з усіх країн.';
 return {title,rows,comparisons,note};
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
