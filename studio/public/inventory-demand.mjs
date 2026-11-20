import {addDays,rangeDays} from './overview-filters.mjs';
import {smoothPath} from './weekly-charts.mjs';
import {bindTitleTooltips} from './tap-tooltip.mjs';
import {
  inventoryColumns,inventoryConfidence,inventoryDefaults,inventoryDemand,inventoryMatrix,
  inventoryPrice,inventorySelection,inventoryStatuses,inventoryWatchColumns,inventoryWatchStatuses,qualityLabels,
} from './inventory-demand-filters.mjs';

const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const numbers = new Intl.NumberFormat('uk-UA',{maximumFractionDigits:1});
const currency = new Intl.NumberFormat('uk-UA',{style:'currency',currency:'UAH',maximumFractionDigits:0});
const compact = new Intl.NumberFormat('uk-UA',{notation:'compact',maximumFractionDigits:1});
const num = value => Number.isFinite(value) ? numbers.format(value) : '—';
const money = value => Number.isFinite(value) ? currency.format(value) : '—';
const dayLabel = date => date ? date.split('-').reverse().join('.') : '—';
const spanLabel = range => `${dayLabel(range.from)} – ${dayLabel(range.to)}`;
const htmlButton = (attribute,value,label,active) => `<button type="button" ${attribute}="${escape(value)}"${active===undefined?'':` aria-pressed="${active}"`}>${escape(label)}</button>`;
const statusText = row => row.statusLabel ?? inventoryStatuses[row.status];
const valueOf = (row,key) => {
  if (key==='status') return statusText(row);
  if (key==='confidence') return inventoryConfidence[row.confidence] ?? '—';
  if (key==='lastLoss') return dayLabel(row.lastLoss);
  if (['dailyRevenue','loss','margin','revenue'].includes(key)) return money(row[key]);
  if (['outDays','dailyUnits','views','stock'].includes(key)) return num(row[key]);
  if (key==='watchStatus') return inventoryWatchStatuses[row.watchStatus];
  return row[key] ?? '—';
};

function select(fields,key,label,options) {
  const choices = [['','Усі'],...options];
  if (fields[key] && fields[key]!=='all' && !choices.some(([value])=>value===fields[key])) {
    choices.push([fields[key],fields[key]]);
  }
  return `<label>${label}<select name="${key}">${choices.map(([value,caption])=>
    `<option value="${escape(value)}"${value===(fields[key]==='all'?'':fields[key])?' selected':''}>${escape(caption)}</option>`).join('')}</select></label>`;
}

function filters(fields,facets,today,expanded) {
  const values = options => (options || []).map(name=>[name,name]);
  const yesterday = addDays(today,-1);
  const preset = fields.to===yesterday && [7,30,90].includes(rangeDays(fields)) ? String(rangeDays(fields)) : 'custom';
  return `<form class="bo-card bo-demand-panel id-filters" data-inventory-filters>
    <div class="id-filter-top">
      <div class="bo-segments" role="group" aria-label="Період звіту">
        ${[[7,'7 днів'],[30,'30 днів'],[90,'90 днів'],['custom','Власний']].map(([id,label])=>htmlButton('data-period',id,label,preset===String(id))).join('')}
      </div>
      <label>Від<input type="date" required name="from" value="${fields.from}" max="${yesterday}"></label>
      <label>До<input type="date" required name="to" value="${fields.to}" max="${yesterday}"></label>
      <label class="id-search">Знайти товар<input type="search" name="search" value="${escape(fields.search)}" maxlength="160" placeholder="SKU або назва"></label>
      <div class="id-actions"><button type="submit">Застосувати</button><button type="button" data-reset>Скинути</button></div>
    </div>
    <details data-inventory-advanced${expanded?' open':''}><summary>Фільтри товарів</summary>
      <div class="id-filter-options">
        ${select(fields,'category','Категорія',values(facets?.categories))}
        ${select(fields,'subcategory','Підкатегорія',values(facets?.subcategories))}
        ${select(fields,'brand','Бренд',values(facets?.brands))}
        ${select(fields,'status','Доступність',Object.entries(inventoryStatuses))}
        ${select(fields,'demand','Рівень попиту',Object.entries(inventoryDemand))}
        ${select(fields,'price','Ціновий сегмент',Object.entries(inventoryPrice))}
        ${select(fields,'promo','Акційність',[['yes','Акційні'],['no','Неакційні'],['unknown','Невідомо']])}
        <label>Мін. днів недоступності<input type="number" name="minDays" min="0" max="90" value="${fields.minDays}"></label>
        <label>Макс. днів недоступності<input type="number" name="maxDays" min="0" max="90" value="${fields.maxDays}"></label>
      </div>
    </details>
    ${fields.quadrant!=='all' ? `<div class="id-active">${htmlButton('data-quadrant',fields.quadrant,`${inventoryMatrix[fields.quadrant]} ×`,true)}</div>` : ''}
    <p data-filter-error role="alert" class="id-error" hidden></p>
  </form>`;
}

function kpis(report) {
  const {current,previous,days,sales,previousSales}=report.coverage;
  const comparable=current===days && previous===days && sales===days && previousSales===days;
  const cards = [
    ['out','Недоступні SKU',num,'На кінець періоду'],['confirmed','Недоступні SKU з підтвердженим попитом',num,'Регулярні продажі в історії'],
    ['averageDays','Середня тривалість відсутності',num,'Середня кількість днів за SKU з відсутністю'],
    ['loss','Потенційно втрачений оборот',money,`Прогноз для ${num(report.current.modeled)} із ${num(report.current.impacted)} SKU`],
    ['margin','Потенційно втрачена маржа',money,`Покриття собівартості для ${num(report.current.marginSku)} SKU`],
  ];
  return `<div class="bo-card bo-demand-kpis" aria-label="Показники звіту">${cards.map(([key,title,format,note])=>{
    const current=report.current[key], previous=report.prior[key];
    const delta=!comparable || current===null || previous===null ? null : current-previous;
    return `<div><span>${title}</span><strong${['loss','margin'].includes(key)?' class="bo-demand-loss"':''}>${format(current)}</strong>
      <small>${note}</small><small>Попередній період <b>${format(previous)}</b>${delta===null?'':` · ${delta>0?'+':''}${format(delta)}`}</small></div>`;
  }).join('')}</div>`;
}

function pointsFor(series,units,interval) {
  const result = [];
  for (const [i,day] of series.entries()) {
    const actual=units?day.units:day.actual, loss=units?day.lostUnits:day.loss;
    let bin = result.at(-1);
    if (interval==='day' || i%7===0) {
      bin={from:day.date,to:day.date,actual:0,loss:0,actualDays:0,estimateDays:0,totalDays:0,partial:false};
      result.push(bin);
    }
    bin.to=day.date;
    bin.totalDays++;
    if (actual!==null) { bin.actual+=actual; bin.actualDays++; }
    if (loss!==null) { bin.loss+=loss; bin.estimateDays++; }
    bin.partial ||= day.partial;
  }
  return result.map(bin=>{
    const actual = bin.actualDays===bin.totalDays ? bin.actual : null;
    const loss = bin.estimateDays ? bin.loss : null;
    return {...bin,actual,loss,expected:actual===null || loss===null ? null : actual+loss,
      partial:bin.partial || bin.estimateDays!==bin.totalDays};
  });
}

function chartPlot(points,format,interval,width,fillId,tabIndex) {
  const height=width<580 ? 192 : 242;
  const left=62,right=width-18,top=14,bottom=height-26;
  const highest=Math.max(1,...points.flatMap(point=>[point.actual ?? 0,point.expected ?? 0,point.loss ?? 0]));
  const lowest=Math.min(0,...points.map(point=>point.actual ?? 0));
  const magnitude=10**Math.floor(Math.log10((highest-lowest)/4));
  const step=Math.ceil((highest-lowest)/4/magnitude)*magnitude;
  const min=Math.floor(lowest/step)*step, max=Math.ceil(highest/step)*step;
  const scale=value=>top+(max-value)/(max-min)*(bottom-top);
  const slot=(right-left)/points.length, x=index=>left+(index+.5)*slot;
  const paths = key => {
    const runs = [];
    for (const [i,point] of points.entries()) {
      if (point[key]===null) continue;
      if (i===0 || points[i-1][key]===null) runs.push([]);
      runs.at(-1).push([x(i),scale(point[key])]);
    }
    return runs.map(run=>({run,path:smoothPath(run)}));
  };
  const actual=paths('actual'), expected=paths('expected'), zero=scale(0);
  const labels=new Set([0,Math.floor((points.length-1)/2),points.length-1]);
  const grid = Array.from({length:Math.round((max-min)/step)+1},(_,i)=>min+step*i);
  const barWidth=Math.min(20,slot*.55);
  const line = (segments,type) => segments.map(({run,path})=>run.length===1
    ? `<circle class="id-point-${type}" cx="${run[0][0]}" cy="${run[0][1]}" r="2.5"/>`
    : `<path d="${path}" class="${type==='actual'?'bo-current-line':'bo-prior-line'} id-${type}"/>`).join('');
  return `<svg class="id-chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="Фактичні та прогнозні продажі">
    <defs><linearGradient id="${fillId}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="var(--blue)" stop-opacity=".16"/><stop offset="1" stop-color="var(--blue)" stop-opacity=".025"/>
    </linearGradient></defs>
    ${grid.map(value=>`<path d="M${left} ${scale(value)}H${right}" class="bo-chart-grid"/><text x="${left-8}" y="${scale(value)+3}" text-anchor="end">${compact.format(value)}</text>`).join('')}
    ${actual.filter(({run})=>run.length>1).map(({run,path})=>
      `<path d="${path} L${run.at(-1)[0]},${zero} L${run[0][0]},${zero}Z" fill="url(#${fillId})"/>`).join('')}
    ${points.map((point,i)=>point.loss>0?`<rect class="id-chart-loss" x="${x(i)-barWidth/2}" y="${scale(point.loss)}" width="${barWidth}" height="${zero-scale(point.loss)}" rx="2"/>`:'').join('')}
    ${line(expected,'expected')}${line(actual,'actual')}
    ${[...labels].map(i=>`<text x="${x(i)}" y="${height-7}" text-anchor="middle">${dayLabel(points[i].from).slice(0,5)}</text>`).join('')}
    ${points.map((point,i)=>`<g class="id-chart-target">
      <g class="id-chart-cursor" aria-hidden="true">
        <path class="bo-crosshair" d="M${x(i)} ${top}V${bottom}"/>
        ${point.expected!==null && point.expected!==point.actual?`<circle class="id-cursor-expected" cx="${x(i)}" cy="${scale(point.expected)}" r="3.5"/>`:''}
        ${point.actual!==null?`<circle class="id-cursor-actual" cx="${x(i)}" cy="${scale(point.actual)}" r="4"/>`:''}
      </g>
      <rect class="id-chart-hit" x="${left+slot*i}" y="${top}" width="${slot}" height="${bottom-top}"
        data-chart-index="${i}" tabindex="${i===tabIndex?0:-1}" role="button" aria-label="${interval==='day'?dayLabel(point.from):spanLabel(point)}, факт ${format(point.actual)}, прогноз ${format(point.expected)}, втрати ${format(point.loss)}"/>
    </g>`).join('')}
    </svg>`;
}

function chartMarkup(points,fillId) {
  if (!points.some(point=>point.actual!==null || point.loss!==null)) {
    return '<p class="bo-demand-empty">Недостатньо даних для побудови графіка.</p>';
  }
  return `<div class="id-chart-plot" data-chart-plot="${fillId}"></div>
    <div class="bo-demand-legend"><span><i></i>Фактичні продажі</span><span><i class="id-forecast-key"></i>Прогноз без дефіциту</span><span><i class="id-loss-key"></i>Потенційні втрати</span></div>
    <p class="bo-demand-day" data-chart-caption aria-live="polite"></p>`;
}

function chart(report,units,interval) {
  const points = pointsFor(report.chart,units,interval);
  const format = units ? num : money;
  return {points,format,markup:`<section class="bo-card bo-demand-panel id-chart-panel"><header><div><h2>Динаміка продажів і втрат</h2>
    <p>Прогноз враховує SKU з достатньою історією.</p></div><div class="id-chart-switches">
    <div class="bo-segments" aria-label="Одиниця виміру">${htmlButton('data-chart-units','0','Грн',!units)}${htmlButton('data-chart-units','1','Од.',units)}</div>
    <div class="bo-segments" aria-label="Групування">${htmlButton('data-chart-interval','day','Дні',interval==='day')}${htmlButton('data-chart-interval','week','Тижні',interval==='week')}</div>
    </div></header>${chartMarkup(points,'inventory-sales-fill')}</section>`};
}

function priorityTable(rows,estimates) {
  return `<div class="bo-demand-table id-priority-table" role="region" aria-label="${estimates?'Оцінка втрат за товаром':'Фактичні продажі до дефіциту'}">
    <table><thead><tr><th scope="col">Товар</th><th scope="col">Днів недоступності поспіль</th>
      <th scope="col">${estimates?'Потенційно втрачений оборот':'Фактичний оборот у дні доступності'}</th>
      <th scope="col">${estimates?'Потенційно втрачена маржа':'Днів із продажами'}</th></tr></thead>
      <tbody>${rows.map(row=>`<tr><th scope="row">${htmlButton('data-inventory-sku',row.code,row.name)}
        <small>${escape(row.code)} · ${escape(row.brand)} · ${escape(row.statusLabel)}</small></th><td>${num(row.outDays)}</td>
        <td>${money(estimates?row.loss:row.revenue)}</td><td>${estimates?money(row.margin):num(row.saleDays)}</td></tr>`).join('')}</tbody>
    </table></div>`;
}

function priorityContent(result) {
  if (!result) return '<p class="bo-demand-empty" role="status">Завантажуємо пріоритети на вибраний день…</p>';
  if (!result.statusAvailable) return '<p class="bo-demand-empty">За цей день для вибраних товарів немає даних про доступність.</p>';
  if (!result.out) return '<p class="bo-demand-empty">За доступними статусами на цю дату недоступних товарів немає.</p>';
  return `<p class="id-priority-coverage" role="status">Недоступні ${num(result.out)} SKU · оцінено оборот для ${num(result.modeled)} · оцінено маржу для ${num(result.marginSku)}
    ${result.margin===null?'':` · потенційно втрачена маржа <strong>${money(result.margin)}</strong>`}.</p>
    ${result.rows.length?`<h3>За оцінкою втраченої маржі за день</h3>
      <p>Товари з оцінкою маржі впорядковані за маржею. Решта — за потенційно втраченим оборотом.
      ${result.modeled>result.rows.length?` Показано ${num(result.rows.length)} з ${num(result.modeled)} SKU.`:''}</p>
      ${priorityTable(result.rows,true)}`:'<p>Для прогнозу втрат на цю дату поки бракує історії продажів і доступності.</p>'}
    ${result.evidence.length?`<h3>Фактичні продажі до дефіциту</h3>
      <p>Оборот із відвантажень ERP за спостережені дні доступності протягом 70 днів перед дефіцитом.
      ${result.evidenceCount>result.evidence.length?` Показано ${num(result.evidence.length)} з ${num(result.evidenceCount)} SKU.`:''}</p>
      ${priorityTable(result.evidence,false)}`:''}`;
}

function replenishment(report,selected,priority,points) {
  return `<section class="bo-card bo-demand-panel id-replenishment" id="replenishment-priority" aria-labelledby="replenishment-title">
    <header><div><h2 id="replenishment-title" tabindex="-1">Пріоритет поповнення</h2>
      <p>Які недоступні товари варто повернути в продаж першими.</p></div>
      <label class="id-priority-date">Дата <select data-priority-date aria-label="Дата пріоритету поповнення">
        ${report.chart.toReversed().map(({date})=>`<option value="${date}"${date===selected?' selected':''}>${dayLabel(date)}</option>`).join('')}
      </select></label>
    </header>
    ${chartMarkup(points,'inventory-priority-fill')}
    <div class="id-priority-content" data-priority-content>${priorityContent(priority)}</div>
  </section>`;
}

function ranking(title,entries,field,current) {
  const largest = entries[0]?.[1] || 1;
  return `<section class="bo-card bo-demand-panel"><header><h2>${title}</h2></header>
    ${entries.length?`<div class="bo-demand-bars id-bars">${entries.map(([label,value])=>
      `<button type="button" data-rank-field="${field}" data-rank-value="${escape(label)}" aria-pressed="${current===label}">
        <span>${escape(label)}</span><span class="bo-demand-track" aria-hidden="true"><i style="width:${value/largest*100}%"></i></span><b>${money(value)}</b></button>`).join('')}</div>`:
      '<p class="bo-demand-empty">Для цього зрізу оцінених втрат немає.</p>'}</section>`;
}

function matrix(values,active) {
  return `<section class="bo-card bo-demand-panel"><header><div><h2>Попит × Наявність</h2><p>Попит порівнюємо в межах категорії. Висока наявність — від 90% спостережених днів.</p></div></header>
    <div class="id-matrix"><span></span><b>Висока наявність</b><b>Низька наявність</b><b>Високий попит</b>
      ${['stable','priority'].map(cell=>matrixCell(cell,values,active)).join('')}<b>Низький попит</b>
      ${['excess','low'].map(cell=>matrixCell(cell,values,active)).join('')}</div>
    </section>`;
}

function matrixCell(cell,values,active) {
  return `<button type="button" data-quadrant="${cell}" aria-pressed="${active===cell}"><span>${inventoryMatrix[cell]}</span><strong>${num(values[cell])} SKU</strong></button>`;
}

function table(report,selection) {
  const {rows,total,page,pages} = report.table;
  const watch = report.stockWatch;
  const isWatch = selection.view!=='all';
  const labels = isWatch ? inventoryWatchColumns : inventoryColumns;
  return `<section class="bo-card bo-demand-panel id-table-panel" data-inventory-table>
    <header><div><h2 tabindex="-1">Деталізація SKU</h2><p>${num(total)} товарів у таблиці</p></div>
      <button type="button" class="id-button" data-export${total?'':' disabled'}>Експорт в Excel</button></header>
    <div class="id-table-tools"><div class="bo-segments" aria-label="Режим таблиці">
      ${htmlButton('data-inventory-view','all','Аналітика SKU',selection.view==='all')}
      ${htmlButton('data-inventory-view','alerts',`Сигнали${watch.available?' · '+num(watch.alerts):''}`,selection.view==='alerts')}
      ${htmlButton('data-inventory-view','watch',`На контролі${watch.available?' · '+num(watch.monitored):''}`,selection.view==='watch')}
    </div></div>
    ${isWatch?`<p class="bo-demand-empty">Контроль залишків · від 5 000 грн виторгу сайту з початку року і від 100 переглядів за 7 днів до кінця періоду.
      ${watch.notice?escape(watch.notice):'Для сигналів застосовуються пороги залишку за категоріями.'}</p>`:''}
    ${rows.length?`<div class="bo-demand-table id-table" role="region" aria-label="Таблиця товарів" tabindex="0"><table><thead><tr>
      ${Object.entries(labels).map(([key,label])=>`<th scope="col" aria-sort="${key===selection.sort?(selection.direction==='desc'?'descending':'ascending'):'none'}">
        ${key in inventoryColumns && !isWatch ? htmlButton('data-inventory-sort',key,label+(key===selection.sort?(selection.direction==='desc'?' ↓':' ↑'):'')) : escape(label)}</th>`).join('')}
      </tr></thead><tbody>${rows.map(row=>`<tr>${Object.keys(labels).map(key=>key==='name'?
        `<th scope="row">${htmlButton('data-inventory-sku',row.code,row.name)}${row.subcategory&&row.subcategory!==row.category?`<small>${escape(row.subcategory)}</small>`:''}</th>`:
        `<td${key==='confidence' && row.flags.length?` title="${escape(row.flags.map(flag=>qualityLabels[flag]).join(' · '))}"`:''}>${escape(valueOf(row,key))}
          ${key==='confidence' && row.flags.includes('irregular')?'<small>Нерегулярний попит</small>':''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:
      '<p class="bo-demand-empty">За вибраними фільтрами товарів немає.</p>'}
    ${pages>1?`<div class="id-paging"><button type="button" data-table-page="${page-1}"${page===1?' disabled':''}>Назад</button>
      <span>Сторінка ${num(page)} з ${num(pages)}</span><button type="button" data-table-page="${page+1}"${page===pages?' disabled':''}>Далі</button></div>`:''}
    <p data-table-error class="id-error" role="alert" hidden></p>
    </section>`;
}

function detailContent({row,days,outages},points) {
  const summary = ['status','lastLoss','outDays','dailyRevenue','dailyUnits','loss','margin','confidence'];
  return `<h2 data-detail-title>${escape(row.name)}</h2><p>${escape(row.code)} · ${escape(row.brand)} · ${escape(row.subcategory)}</p>
    <dl class="id-detail-metrics">${summary.map(key=>`<div><dt>${inventoryColumns[key]}</dt><dd>${escape(valueOf(row,key))}</dd></div>`).join('')}</dl>
    <p>Остання база прогнозу · ${num(row.sampleDays)} днів доступності, ${num(row.saleDays)} днів з продажами, ${num(row.weeks)} тижнів з продажами.</p>
    ${row.outDays>0?`<p>Оцінено ${num(row.modeledDays)} з ${num(row.outDays)} днів недоступності. Маржу розраховано для ${num(row.marginDays)} днів.</p>`:''}
    ${row.backtest?`<p>Історична перевірка за ${num(row.backtest.days)} днів · факт ${money(row.backtest.actual)}, прогноз ${money(row.backtest.predicted)}, похибка ${num(row.backtest.error*100)}%.</p>`:''}
    ${row.flags.length?`<ul class="id-quality">${row.flags.map(flag=>`<li>${escape(qualityLabels[flag])}</li>`).join('')}</ul>`:''}
    <h3>Динаміка продажів</h3><div data-detail-chart>${chartMarkup(points,'inventory-sku-fill')}</div>
    <h3>Періоди недоступності</h3>${outages.length?`<ul>${outages.map(outage=>`<li>${spanLabel(outage)} · ${num(outage.days)} дн.</li>`).join('')}</ul>`:
      '<p>У доступних знімках періодів недоступності немає.</p>'}
    <h3>Історія доступності, ціни й акцій</h3>
    <div class="bo-demand-table id-table" tabindex="0" role="region" aria-label="Історія товару"><table><thead><tr>
      <th>День</th><th>Доступність</th><th>Оборот</th><th>Відвантажено</th><th>Втрати</th><th>Ціна</th><th>Акція</th></tr></thead><tbody>
      ${days.map(day=>`<tr><th scope="row">${dayLabel(day.date)}</th><td>${escape(statusText(day))}</td><td>${money(day.revenue)}</td>
        <td>${num(day.units)}</td><td>${money(day.loss)}</td><td>${money(day.price)}</td>
        <td>${day.promo==='yes'?'Так':day.promo==='no'?'Ні':'—'}</td></tr>`).join('')}</tbody></table></div>`;
}

const methodology = `<details class="bo-card bo-demand-panel id-method"><summary>Як рахуємо прогноз</summary>
  <p>Доступність визначається за спостереженим статусом каталогу. «В наявності» та «Під замовлення» входять до днів доступності. Прогалини в історії не зараховуються до днів відсутності. Зміна між двома спостереженими днями підтверджує дату втрати доступності.</p>
  <p>Для кожного епізоду недоступності використовуємо до 70 попередніх календарних днів. Беремо відвантажені продажі сайту за днями доступності й враховуємо повернення у грошовому обороті. Мінімум для прогнозу — 21 день доступності та продажі щонайменше в три дні протягом трьох тижнів.</p>
  <p>Середньоденний оборот множимо на підтверджені дні недоступності. Маржу показуємо за покриття собівартістю від 90% обороту в базі. Для кількості використовуємо одиниці відвантаження ERP.</p>
  <p>Якщо даних достатньо, база використовує дні без акцій. Концентрація продажів, зміни ціни понад 20%, сильні коливання, вплив акцій і похибка історичної перевірки знижують достовірність. Для перевірки останні сім днів бази відокремлюються від навчальної вибірки. Одного вікна до 70 днів недостатньо для оцінювання річної сезонності.</p>
</details>`;

async function request(fields,signal) {
  const params = new URLSearchParams(fields);
  const response = await fetch('/api/inventory-demand?'+params,{signal});
  const value = await response.json();
  if (!response.ok || !value.available) throw Error(value.notice || 'Дані звіту тимчасово недоступні.');
  return value;
}

export function mountInventoryDemand(root,today) {
  root.innerHTML = '<div class="bo-demand inventory-report"><div data-inventory-main></div><dialog class="id-dialog" aria-label="Деталі SKU"><form method="dialog"><button aria-label="Закрити">×</button></form><div data-inventory-detail></div></dialog></div>';
  const host = root.firstElementChild, main = host.querySelector('[data-inventory-main]');
  const dialog = host.querySelector('dialog'), detail = host.querySelector('[data-inventory-detail]');
  let applied = inventorySelection(inventoryDefaults(today),today), report = null, pending, detailRequest;
  let priorityDate, priority, priorityPending, selectPriorityPoint;
  let openPriority = new URLSearchParams(location.hash.split('?')[1]).get('panel')==='replenishment';
  let expanded=false,units=false,interval='day';

  function bindChart(container,points,format,grouping='day',{initialDate,onSelect}={}) {
    const plot=container.querySelector('[data-chart-plot]');
    const caption=container.querySelector('[data-chart-caption]');
    if (!plot || !caption) return;
    const selectedIndex=points.findIndex(point=>point.from===initialDate);
    let selected=selectedIndex>=0 ? selectedIndex : points.findLastIndex(point=>point.actual!==null || point.loss!==null);
    let committed=selected, tabIndex=selected, width=0, active=null;
    function highlight(i,showCursor) {
      selected=i;
      const point=points[i];
      active?.classList.remove('active');
      active=showCursor ? plot.querySelector(`[data-chart-index="${i}"]`)?.parentElement : null;
      active?.classList.add('active');
      caption.innerHTML=`<strong>${point.from===point.to?dayLabel(point.from):spanLabel(point)}</strong>
        <span>Факт <b>${format(point.actual)}</b></span><span>Прогноз <b>${format(point.expected)}</b></span>
        <span>Втрати <b>${format(point.loss)}</b></span>${point.partial?'<span>Неповне покриття</span>':''}`;
    }
    function draw() {
      const nextWidth=plot.clientWidth;
      if (!nextWidth || nextWidth===width) return;
      width=nextWidth;
      const focused=plot.contains(document.activeElement);
      const wasActive=Boolean(active);
      plot.innerHTML=chartPlot(points,format,grouping,width,plot.dataset.chartPlot,tabIndex);
      const buttons=[...plot.querySelectorAll('[data-chart-index]')];
      for (const [i,button] of buttons.entries()) {
        button.onpointerenter=()=>highlight(i,true);
        button.onfocus=()=>{
          buttons[tabIndex].tabIndex=-1;
          button.tabIndex=0;
          tabIndex=i;
          highlight(i,true);
        };
        button.onclick=()=>{
          button.onfocus();
          onSelect?.(points[i].from);
        };
        button.onkeydown=event=>{
          if (onSelect && ['Enter',' '].includes(event.key)) {
            event.preventDefault();
            onSelect(points[i].from);
            return;
          }
          if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
          event.preventDefault();
          buttons[i+(event.key==='ArrowRight'?1:-1)]?.focus();
        };
      }
      highlight(selected,wasActive || selectedIndex>=0);
      if (focused) buttons[tabIndex].focus({preventScroll:true});
    }
    plot.onpointerleave=()=>{
      if (!plot.contains(document.activeElement)) highlight(onSelect?committed:selected,Boolean(onSelect));
    };
    plot.onfocusout=event=>{
      if (!plot.contains(event.relatedTarget)) highlight(onSelect?committed:selected,Boolean(onSelect));
    };
    const resize=new ResizeObserver(()=>{
      if (plot.isConnected) draw();
      else resize.disconnect();
    });
    resize.observe(plot);
    draw();
    return date=>{
      const index=points.findIndex(point=>point.from===date);
      if (index>=0) {
        committed=index;
        highlight(index,true);
      }
    };
  }

  function jumpToPriority() {
    const title=main.querySelector('#replenishment-title');
    title?.focus({preventScroll:true});
    title?.closest('section').scrollIntoView({block:'start'});
  }

  async function loadPriority(date) {
    const content=main.querySelector('[data-priority-content]');
    if (!content) return;
    priorityDate=date;
    main.querySelector('[data-priority-date]').value=date;
    selectPriorityPoint?.(date);
    priorityPending?.abort();
    if (report.priority?.date===date) priority=report.priority;
    if (priority?.date===date) {
      content.innerHTML=priorityContent(priority);
      return;
    }
    priority=null;
    content.innerHTML=priorityContent(null);
    const controller=new AbortController();
    priorityPending=controller;
    try {
      const result=await request({...applied,priorityDate:date},controller.signal);
      if (!host.isConnected || controller.signal.aborted) return;
      priority=result.priority;
      main.querySelector('[data-priority-content]').innerHTML=priorityContent(priority);
    } catch (error) {
      if (!host.isConnected || controller.signal.aborted) return;
      main.querySelector('[data-priority-content]').innerHTML=`<p class="id-error" role="alert">${escape(error.message)}</p>
        <button type="button" class="id-button" data-retry-priority>Повторити</button>`;
    }
  }

  function show() {
    const visual=chart(report,units,interval);
    const priorityPoints=pointsFor(report.chart,false,'day');
    const {coverage,range,previous}=report;
    main.innerHTML=`${filters(applied,report.facets,today,expanded)}
      <div class="id-coverage-row"><p class="id-coverage">Звіт ${spanLabel(range)} · статуси ${coverage.current}/${coverage.days} · ERP ${coverage.sales}/${coverage.days} днів.
      Попередній період ${spanLabel(previous)} · статуси ${coverage.previous}/${coverage.days} · ERP ${coverage.previousSales}/${coverage.days} днів.</p>
      <button type="button" class="id-button" data-jump-priority>Пріоритет поповнення ↓</button></div>
      ${kpis(report)}${report.current.impacted && !report.current.modeled ?
        '<p class="id-coverage">Для SKU з підтвердженими днями недоступності поки бракує історії доступності та продажів для прогнозу.</p>' : ''}
      ${visual.markup}
      <div class="id-rank-grid">${applied.category ?
        ranking('Втрати за підкатегоріями',report.categories,'subcategory',applied.subcategory) :
        ranking('Втрати за категоріями',report.categories,'category',applied.category)}
      ${ranking('Втрати за брендами',report.brands,'brand',applied.brand)}</div>
      ${matrix(report.matrix,applied.quadrant)}${table(report,applied)}${methodology}
      ${replenishment(report,priorityDate,priority,priorityPoints)}`;
    bindTitleTooltips(main, '[data-inventory-table] td[title]');
    bindChart(main,visual.points,visual.format,interval);
    selectPriorityPoint=bindChart(main.querySelector('#replenishment-priority'),priorityPoints,money,'day',
      {initialDate:priorityDate,onSelect:loadPriority});
    if (openPriority) {
      openPriority=false;
      jumpToPriority();
    }
  }

  async function load(next,focus) {
    let valid;
    try { valid=inventorySelection(next,today); }
    catch {
      const error=main.querySelector('[data-filter-error]');
      error.hidden=false;error.textContent='Перевірте фільтри й оберіть період до 90 завершених днів.';
      return;
    }
    applied=valid;
    pending?.abort();
    priorityPending?.abort();
    const controller=new AbortController();
    pending=controller;
    const facets=report?.facets;
    main.innerHTML=`${filters(applied,facets,today,expanded)}<p class="bo-card bo-demand-panel" role="status">Завантажуємо дані звіту…</p>`;
    try {
      const data=await request(applied,controller.signal);
      if (!host.isConnected || controller.signal.aborted) return;
      report=data;
      if (!priorityDate || priorityDate<valid.from || priorityDate>valid.to) priorityDate=valid.to;
      priority=data.priority?.date===priorityDate ? data.priority : null;
      show();
      if (!priority) loadPriority(priorityDate);
      if (focus) {
        const target=main.querySelector(focus);
        target?.focus({preventScroll:true});
        if (focus==='[data-inventory-table] h2') target?.scrollIntoView({block:'center'});
      }
    } catch (error) {
      if (!host.isConnected || controller.signal.aborted) return;
      main.innerHTML=`${filters(applied,facets,today,expanded)}<div class="bo-card bo-demand-panel" role="alert">
        <p>${escape(error.message)}</p><button type="button" class="id-button" data-retry>Повторити</button></div>`;
    }
  }

  async function showDetail(sku) {
    detailRequest?.abort();
    const controller=new AbortController();
    detailRequest=controller;
    detail.innerHTML='<p role="status">Завантажуємо деталі SKU…</p>';
    if (!dialog.open) dialog.showModal();
    try {
      const response=await request({...applied,sku},controller.signal);
      if (!dialog.open || controller.signal.aborted) return;
      if (response.detail) {
        const points=pointsFor(response.detail.days.map(day=>({date:day.date,actual:day.revenue,loss:day.loss,partial:day.status==='unknown'})),false,'day');
        detail.innerHTML=detailContent(response.detail,points);
        bindChart(detail,points,money);
      } else {
        detail.innerHTML='<p>Дані SKU за цей період недоступні.</p>';
      }
    } catch (error) {
      if (!controller.signal.aborted && dialog.open) detail.innerHTML=`<p role="alert">${escape(error.message)}</p>`;
    }
  }

  async function exportTable(button) {
    button.disabled=true;
    button.textContent='Готуємо Excel…';
    try {
      const response=await request({...applied,export:'1'});
      const decoded=Uint8Array.from(atob(response.file),character=>character.charCodeAt(0));
      const url=URL.createObjectURL(new Blob([decoded],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      const link=document.createElement('a');
      link.href=url;link.download=response.filename;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch {
      const message=button.closest('[data-inventory-table]')?.querySelector('[data-table-error]');
      if (message) { message.hidden=false;message.textContent='Не вдалося сформувати Excel. Спробуйте ще раз.'; }
    } finally { button.disabled=false;button.textContent='Експорт в Excel'; }
  }

  dialog.addEventListener('close',()=>detailRequest?.abort());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const {top,right,bottom,left} = dialog.getBoundingClientRect();
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) dialog.close();
  });
  host.addEventListener('toggle',event=>{
    if (event.target.matches('[data-inventory-advanced]')) expanded=event.target.open;
  },true);
  host.addEventListener('submit',event=>{
    if (!event.target.matches('[data-inventory-filters]')) return;
    event.preventDefault();
    const values=Object.fromEntries(new FormData(event.target));
    for (const key of ['status','demand','price','promo']) values[key] ||= 'all';
    load({...applied,...values,page:'1'});
  });
  host.addEventListener('change',event=>{
    if (event.target.name==='category') event.target.form.elements.subcategory.value='';
    if (event.target.matches('[data-priority-date]')) loadPriority(event.target.value);
  });
  host.addEventListener('click',event=>{
    const button=event.target.closest('button');
    if (!button) return;
    const data=button.dataset;
    if (data.reset!==undefined) {
      expanded=false;
      load(inventoryDefaults(today));
    } else if (data.retry!==undefined) {
      load(applied);
    } else if (data.jumpPriority!==undefined) {
      jumpToPriority();
    } else if (data.retryPriority!==undefined) {
      loadPriority(priorityDate);
    } else if (data.period) {
      if (data.period==='custom') main.querySelector('[name="from"]').focus();
      else load({...applied,from:addDays(today,-Number(data.period)),to:addDays(today,-1),page:'1'});
    } else if (data.rankField) {
      if (data.rankField==='category') expanded=true;
      load({...applied,[data.rankField]:applied[data.rankField]===data.rankValue?'':data.rankValue,
        ...(data.rankField==='category'?{subcategory:''}:{}),view:'all',page:'1'},'[data-inventory-table] h2');
    } else if (data.quadrant) {
      load({...applied,quadrant:applied.quadrant===data.quadrant?'all':data.quadrant,view:'all',page:'1'},'[data-inventory-table] h2');
    } else if (data.chartUnits!==undefined || data.chartInterval) {
      if (data.chartUnits!==undefined) units=data.chartUnits==='1';
      else interval=data.chartInterval;
      show();
      main.querySelector(data.chartInterval?`[data-chart-interval="${interval}"]`:`[data-chart-units="${Number(units)}"]`)?.focus();
    } else if (data.inventoryView) {
      load({...applied,view:data.inventoryView,page:'1',sort:'loss',direction:'desc'},`[data-inventory-view="${data.inventoryView}"]`);
    } else if (data.inventorySort) {
      const sort=data.inventorySort,direction=applied.sort===sort&&applied.direction==='desc'?'asc':'desc';
      load({...applied,sort,direction,page:'1'},`[data-inventory-sort="${sort}"]`);
    } else if (data.tablePage) {
      load({...applied,page:data.tablePage},'[data-inventory-table] h2');
    } else if (data.inventorySku) {
      showDetail(data.inventorySku);
    } else if (data.export!==undefined) {
      exportTable(button);
    }
  });
  load(applied);
}
