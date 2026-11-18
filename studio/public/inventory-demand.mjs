import {smoothPath} from './weekly-charts.mjs';

const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;');
const fmt = new Intl.NumberFormat('uk-UA', {maximumFractionDigits:1});
const money = new Intl.NumberFormat('uk-UA', {notation:'compact',maximumFractionDigits:1});
const num = value => Number.isFinite(value) ? fmt.format(value) : '—';
const hryvnia = value => Number.isFinite(value) ? money.format(value) + ' ₴' : '—';
const fullHryvnia = new Intl.NumberFormat('uk-UA', {style:'currency',currency:'UAH',maximumFractionDigits:2});
const dateLabel = date => date.slice(8,10) + '.' + date.slice(5,7);
const dateFull = date => date.split('-').reverse().join('.');
const statuses = {out:'Менше 1',low:'Запас до 7 днів',unknown:'Немає даних',none:'—'};
const status = value => value === null ? 'Немає знімка' : value < 1 ? 'Менше 1' : 'В наявності';

function timeline(item) {
  if (!item) return '<p class="bo-demand-empty">Немає товарів для вибраного зрізу.</p>';
  const left=45, width=665, step=width/item.days.length, bottom=127;
  const x=i=>left+step*(i+0.5);
  const peak=Math.ceil(Math.max(1,...item.days.map(d=>d.views ?? 0))/10)*10;
  const y=v=>bottom-v/peak*101;
  const docMax=Math.max(1,...item.days.map(d=>d.docs));
  const viewSegments = item.days.reduce((segments,d,i)=>{
    if (d.views !== null) {
      if (i===0 || item.days[i-1].views === null) segments.push([]);
      segments.at(-1).push([x(i),y(d.views)]);
    }
    return segments;
  },[]);
  const positions = [0,Math.floor((item.days.length-1)/2),item.days.length-1];
  const viewPaths = viewSegments.map(points=>({points,path:smoothPath(points)}));
  return `<div class="bo-demand-chart-scroll"><div class="bo-demand-chart">
    <svg viewBox="0 0 730 220" role="img" aria-label="Перегляди картки та відвантаження за днями">
      ${item.days.map((d,i)=>d.stock===null||d.stock<1 ? `<rect x="${left+step*i}" y="18" width="${step}" height="174" class="${d.stock===null?'bo-demand-gap':'bo-demand-out'}"/>`:'').join('')}
      ${[0,peak/2,peak].map(v=>`<path d="M${left} ${y(v)}H710" class="bo-chart-grid"/><text x="37" y="${y(v)+4}" text-anchor="end">${num(v)}</text>`).join('')}
      ${viewPaths.map(({points,path})=>points.length===1
        ? `<circle cx="${points[0][0]}" cy="${points[0][1]}" r="2" fill="var(--blue)"/>`
        : `<path d="${path} L${points.at(-1)[0]},${bottom} L${points[0][0]},${bottom}Z" class="bo-demand-area"/><path d="${path}" class="bo-demand-line"/>`).join('')}
      <path d="M${left} 192H710" class="bo-chart-grid"/>
      ${item.days.map((d,i)=>`<rect x="${x(i)-step/4}" y="${192-36*d.docs/docMax}" width="${step/2}" height="${36*d.docs/docMax}" rx="2" class="bo-demand-ship"/>`).join('')}
      ${positions.map(i=>`<text x="${x(i)}" y="214" text-anchor="middle">${dateLabel(item.days[i].date)}</text>`).join('')}
      ${item.days.map((d,i)=>`<rect data-demand-day="${i}" x="${left+step*i}" y="16" width="${step}" height="178" fill="transparent"
        tabindex="${i===item.days.length-1?0:-1}" role="button" aria-label="${dateFull(d.date)}, перегляди ${num(d.views)}, відвантаження ${num(d.docs)}, залишок ${num(d.stock)}"/>`).join('')}
    </svg>
  </div></div>
  <div class="bo-demand-legend">
    <span><i class="views"></i>Перегляди картки · GA4</span><span><i class="ship"></i>Відвантаження · ERP</span>
    <span><i class="out"></i>Залишок менше 1</span><span><i class="gap"></i>Немає знімка</span>
  </div>
  <p class="bo-demand-day" data-demand-day-label aria-live="polite">${dayText(item.days.at(-1))}</p>`;
}

function dayText(day) {
  return `<strong>${dateFull(day.date)}</strong><span>Перегляди <b>${num(day.views)}</b></span>
    <span>Відвантаження <b>${num(day.docs)}</b></span><span>${status(day.stock)}${day.stock === null ? '' : ` <b>${num(day.stock)}</b>`}</span>`;
}

function stockWatchPanel(watch, rows, watchMode, chosen, segmentSelect, category) {
  const alerts=rows.filter(row=>row.status==='low');
  const visible=watchMode==='alerts'?alerts:rows;
  const watchStatus = {low:'Низький залишок',ok:'Достатній залишок',unknown:'Залишок невідомий'};
  const filters=[['alerts','Сигнали',alerts.length],['monitored','На контролі',rows.length]];
  const empty=watch.available ? (watchMode==='alerts'?'У цьому зрізі немає сигналів.':'У цьому зрізі немає товарів на контролі.') : watch.notice;
  return `<section class="bo-card bo-demand-panel" aria-labelledby="stock-watch-heading">
    <header class="bo-demand-watch-header"><h2 id="stock-watch-heading">Контроль залишків</h2>
      <div class="bo-demand-watch-controls">
        <div class="bo-segments" role="group" aria-label="Стан залишку">${filters.map(([mode,label,count])=>
          `<button type="button" data-demand-watch="${mode}" aria-pressed="${watchMode===mode}">${label}${watch.available?` <span>${num(count)}</span>`:''}</button>`).join('')}</div>
        ${segmentSelect}${category?`<button type="button" class="bo-demand-category-filter" data-demand-clear-category aria-label="Скинути фільтр категорії ${escape(category)}">${escape(category)} <span aria-hidden="true">×</span></button>`:''}
      </div>
    </header>
    ${visible.length?`<div class="bo-demand-table bo-demand-watch-table" tabindex="0" role="region" aria-labelledby="stock-watch-heading">
      <table><thead><tr><th scope="col">Товар</th><th scope="col" aria-sort="descending">Виторг сайту з початку року</th><th scope="col">Перегляди за 7 днів</th><th scope="col">Залишок</th><th scope="col">Стан</th></tr></thead>
      <tbody>${visible.map(row=>`<tr class="${row.code===chosen?'is-selected':''}">
        <th scope="row"><button type="button" data-demand-row="${escape(row.code)}" aria-pressed="${row.code===chosen}">${escape(row.product.name)}</button><small>${escape(row.code)} · ${escape(row.product.segment)}</small></th>
        <td>${fullHryvnia.format(row.revenue)}</td><td>${num(row.views)}</td><td title="Поріг сигналу ≤ ${num(row.threshold)}">${num(row.stock)}</td>
        <td><span class="bo-demand-risk ${row.status==='low'?'out':row.status}">${watchStatus[row.status]}</span></td></tr>`).join('')}</tbody></table>
    </div>`:`<p class="bo-demand-empty" role="status">${escape(empty)}</p>`}
  </section>`;
}

export function mountInventoryDemand(root, report) {
  if (!report?.available) {
    root.innerHTML = `<div class="bo-card bo-demand-empty">${escape(report?.notice || 'Дані про наявність тимчасово недоступні.')}</div>`;
    return;
  }
  const watch=report.stockWatch;
  const items=new Map(report.products.map(item=>[item.code,item]));
  let segmentIndex=0, categoryIndex=null, watchMode='alerts', mode='history', chosen=null, sortBy='missedViews', descending=true;
  const riskOrder = {out:2,low:1,unknown:0,none:-1};
  const columns = [
    ['name','Товар'],['stock','Залишок на дату'],['outDays','Днів без залишку'],
    ['missedViews','Перегляди в ці дні'],['opportunity','Оцінка втрат'],['risk','Ризик'],
  ];
  const compare = (a,b) => {
    if (sortBy==='risk') return riskOrder[a.risk]-riskOrder[b.risk] || a.recentViews-b.recentViews;
    if (sortBy==='name') return a.name.localeCompare(b.name,'uk');
    if (a[sortBy]===null) return b[sortBy]===null?0:descending?-1:1;
    if (b[sortBy]===null) return descending?1:-1;
    return a[sortBy]-b[sortBy];
  };
  function draw(focus) {
    const segment=report.sections[segmentIndex];
    const categories=segment.categorySlices;
    const category=categories[categoryIndex];
    const total=(category || segment).total;
    const rows=category?category.rows.map(code=>items.get(code)):segment.rows;
    const watchRows=(watch.rows || []).map(row=>({...row,product:items.get(row.code)}))
      .filter(({product})=>(segmentIndex===0 || product.segment===segment.segment) && (!category || product.category===category.name));
    const products=new Set([...rows.map(row=>row.code),...watchRows.map(row=>row.code)]);
    const filtered=rows.filter(row=>mode==='risks' ? ['out','low'].includes(row.risk) : row.missedViews>0)
      .sort((a,b)=>compare(a,b)*(descending?-1:1));
    const item=(products.has(chosen) && items.get(chosen)) || filtered[0] || items.get(products.values().next().value);
    chosen=item?.code;
    const max=categories[0]?.views || 1;
    const segmentSelect=`<label class="bo-demand-select">Сегмент <select data-demand-segment>${report.sections.map((s,i)=>
      `<option value="${i}" ${segmentIndex===i?'selected':''}>${escape(s.segment)}</option>`).join('')}</select></label>`;
    root.innerHTML = `<div class="bo-demand">
      <div class="bo-demand-toolbar">
        <p>${dateFull(report.from)} — ${dateFull(report.to)} <span>· Знімки залишків ${report.sourceDays} з 30 днів${watch.available && watch.weekCoverage<watch.viewDays?` · GA4 за ${watch.weekCoverage} із ${watch.viewDays} днів тижня`:''}</span></p>
      </div>
      ${report.trafficAvailable?'':'<p class="bo-demand-empty" role="status">GA4 тимчасово недоступна. Показуємо доступні залишки та відвантаження.</p>'}
      ${stockWatchPanel(watch,watchRows,watchMode,chosen,segmentSelect,category?.name)}
      <div class="bo-card bo-demand-kpis">
        ${[['Оцінка недоотриманого виторгу',hryvnia(total.opportunity),total.priced?`Оцінено ${num(total.priced)} SKU`:'Недостатньо даних для оцінки'],
           ['SKU-дні без залишку',num(total.outDays),'Залишок менше 1 у знімку'],['Перегляди без залишку',num(total.missedViews),'Перегляди карток у ці дні'],
           ['SKU з попитом під ризиком',report.trafficAvailable?num(total.atRisk):'—',`${num(total.outNow)} вже без достатнього залишку`]]
           .map(([label,value,note],i)=>`<div><span>${label}</span><strong class="${i===0?'bo-demand-loss':''}">${value}</strong><small>${note}</small></div>`).join('')}
      </div>
      <div class="bo-demand-grid">
        <section class="bo-card bo-demand-panel"><header><div><h2>Попит і наявність</h2><p>${item?escape(item.name):''}</p></div>
          ${products.size?`<select data-demand-product aria-label="Товар на графіку">${[...products].map(code=>`<option value="${escape(code)}" ${code===chosen?'selected':''}>${escape(items.get(code).name)}</option>`).join('')}</select>`:''}</header>
          ${timeline(item)}
        </section>
        <section class="bo-card bo-demand-panel"><header><div><h2>Де попит залишився без товару</h2><p>Перегляди карток за категоріями</p></div></header>
          ${categories.length?`<div class="bo-demand-bars">${categories.map(({name,views},i)=>
            `<button type="button" data-demand-category="${i}" aria-pressed="${categoryIndex===i}"><span>${escape(name)}</span><span class="bo-demand-track" aria-hidden="true"><i style="width:${views/max*100}%"></i></span><b>${num(views)}</b></button>`).join('')}</div>`:'<p class="bo-demand-empty">За доступними знімками таких переглядів немає.</p>'}
        </section>
      </div>
      <section class="bo-card bo-demand-panel bo-demand-list"><header><div><h2>Товари для перевірки</h2><p>${mode==='risks'?'Є попит, а запас нижче порога або скорочується.':'Товари з найбільшою кількістю переглядів у дні без залишку.'}</p></div>
        <div class="bo-segments" aria-label="Список товарів">${[['history','За період'],['risks','Ризик зараз']].map(([key,label])=>`<button data-demand-mode="${key}" aria-pressed="${mode===key}">${label}</button>`).join('')}</div></header>
        ${filtered.length?`<div class="bo-demand-table"><table><thead><tr>${columns.map(([key,label])=>`<th scope="col" aria-sort="${sortBy===key?(descending?'descending':'ascending'):'none'}"><button type="button" data-demand-sort="${key}">${label}${sortBy===key?(descending?' ↓':' ↑'):''}</button></th>`).join('')}</tr></thead><tbody>
        ${filtered.map(row=>`<tr class="${row.code===chosen?'is-selected':''}">
          <th scope="row"><button type="button" data-demand-row="${escape(row.code)}" aria-pressed="${row.code===chosen}">${escape(row.name)}</button><small>${escape(row.code)} · ${escape(row.category)}</small></th>
          <td>${num(row.stock)}</td><td>${num(row.outDays)}</td><td>${num(row.missedViews)}</td><td>${hryvnia(row.opportunity)}</td>
          <td><span class="bo-demand-risk ${row.risk}">${statuses[row.risk]}</span></td></tr>`).join('')}
        </tbody></table></div>`:'<p class="bo-demand-empty">За доступними даними товарів у цьому списку немає.</p>'}
        <details class="bo-demand-method"><summary>Як рахуємо сигнали, втрати й ризики</summary>
          <p>На контролі товари з виторгом сайту від ${num(watch.minRevenue)} ₴ з початку року і від ${num(watch.minViews)} переглядів за ${watch.viewDays} днів (${dateFull(watch.viewsFrom)} — ${dateFull(report.to)}, дані GA4 за ${watch.weekCoverage} із ${watch.viewDays} днів). Сигнал з’являється при залишку до ${watch.stockThresholds['Плитка']} включно для плитки й підлогових покриттів та до ${watch.stockThresholds['Сантехніка']} включно для сантехніки, будівельної хімії й зарядних станцій. Залишки у складських одиницях каталогу.</p>
          <p>Залишки беруться зі щоденних знімків каталогу. Перегляди й відвантаження зіставляються за товаром і датою. Пропущені знімки виключаємо з підрахунку днів без залишку.</p>
          <p>Оцінка втрат використовує виторг сайту на перегляд картки за дні з наявністю. Для оцінки потрібно щонайменше 7 днів у наявності, 30 переглядів і 3 дні з відвантаженням. Оцінка приблизна.</p>
          <p>Ризик до 7 днів розраховано за медіанним темпом зменшення залишку за останній тиждень. Для ризику потрібні недавні перегляди. Підтверджені поставки, резерви й доступність однієї партії зараз не враховано.</p>
        </details>
      </section>
    </div>`;
    root.querySelector('[data-demand-segment]').onchange=e=>{segmentIndex=Number(e.target.value);categoryIndex=null;chosen=null;draw('[data-demand-segment]');};
    root.querySelectorAll('[data-demand-watch]').forEach(button=>button.onclick=()=>{
      watchMode=button.dataset.demandWatch;
      draw(`[data-demand-watch="${watchMode}"]`);
    });
    root.querySelectorAll('[data-demand-category]').forEach(button=>button.onclick=()=>{
      const index=Number(button.dataset.demandCategory);
      categoryIndex=categoryIndex===index?null:index;chosen=null;
      draw(`[data-demand-category="${index}"]`);
    });
    const clearCategory=root.querySelector('[data-demand-clear-category]');
    if (clearCategory) clearCategory.onclick=()=>{categoryIndex=null;chosen=null;draw('[data-demand-segment]');};
    const product=root.querySelector('[data-demand-product]');
    if (product) product.onchange=e=>{chosen=e.target.value;draw('[data-demand-product]');};
    root.querySelectorAll('[data-demand-mode]').forEach(button=>button.onclick=()=>{
      mode=button.dataset.demandMode;chosen=null;sortBy=mode==='risks'?'risk':'missedViews';descending=true;
      draw(`[data-demand-mode="${mode}"]`);
    });
    root.querySelectorAll('[data-demand-sort]').forEach(button=>button.onclick=()=>{
      const key=button.dataset.demandSort;
      descending=sortBy===key?!descending:key!=='name';sortBy=key;draw(`[data-demand-sort="${key}"]`);
    });
    root.querySelectorAll('[data-demand-row]').forEach(button=>button.onclick=()=>{
      chosen=button.dataset.demandRow;draw();root.querySelector('[data-demand-product]')?.focus();
    });
    const targets=[...root.querySelectorAll('[data-demand-day]')];
    const activate=i=>{
      targets.forEach((target,n)=>target.classList.toggle('is-active',i===n));
      root.querySelector('[data-demand-day-label]').innerHTML=dayText(item.days[i]);
    };
    targets.forEach((target,i)=>{
      target.onpointerenter=()=>activate(i);
      target.onfocus=()=>activate(i);
      target.onclick=()=>activate(i);
      target.onkeydown=event=>{
        if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
        event.preventDefault();const next=targets[i+(event.key==='ArrowLeft'?-1:1)];
        if(next){target.tabIndex=-1;next.tabIndex=0;next.focus();}
      };
    });
    if(focus)root.querySelector(focus)?.focus({preventScroll:true});
  }
  draw();
}
