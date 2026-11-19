import {
  contentDefaults, contentSelection, contentDevices, contentSources, contentPriceBands, contentSorts, minimumContentSample,
} from './content-conversion-filters.mjs';
import {addDays, rangeDays, rangeLabel} from './overview-filters.mjs';

const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const number = new Intl.NumberFormat('uk-UA',{maximumFractionDigits:2});
const preciseNumber = new Intl.NumberFormat('uk-UA',{maximumFractionDigits:4});
const compact = new Intl.NumberFormat('uk-UA',{notation:'compact',maximumFractionDigits:1});
const currency = new Intl.NumberFormat('uk-UA',{style:'currency',currency:'UAH',maximumFractionDigits:2});
const fmt = (value,format=number) => Number.isFinite(value) ? format.format(value) : '—';
const pc = value => Number.isFinite(value) ? fmt(value)+'%' : '—';
const uah = value => fmt(value,currency);
const day = value => value?.slice(0,10).split('-').reverse().join('.') || '—';
const signed = (value,unit) => value == null ? '—' : (value > 0 ? '+' : '')+fmt(value)+' '+unit;
const combine = (a,b,format=fmt) => `${format(a)} → ${format(b)}`;
const diff = (a,b) => a == null || b == null ? null : a-b;
const titles = {score:'Content Score',photos:'Фото',attributes:'Характеристики',reviews:'Відгуки',
  history:'Зміни контенту',opportunity:'Потенціал'};
const metrics = {purchaseRate:'Покупка',atcRate:'Кошик',revenue:'Дохід GA4'};
const groups = ['score','photos','attributes','reviews'];
let savedSelection, savedMetric = 'purchaseRate';

const options = (values,value) => values.map(([key,label])=>
  `<option value="${escape(key)}"${value===key?' selected':''}>${escape(label)}</option>`).join('');
const labels = (values,selected) => [['','Усі'],...[...new Set([...(values || []),selected].filter(Boolean))].map(value=>[value,value])];
const select = (key,title,pairs,value) => `<label>${title}<select name="${key}">${options(pairs,value)}</select></label>`;
const segments = (attribute,choices,selected,label) =>
  `<div class="cv-segments" role="group" aria-label="${label}">${choices.map(([key,text])=>
    `<button type="button" class="cv-control" ${attribute}="${key}" aria-pressed="${key===selected}">${text}</button>`).join('')}</div>`;

const activeFilters = state => [state.root,state.category,state.brand,state.search,
  state.price!=='all',state.stock!=='all',state.promo!=='all',state.device!=='all',state.source!=='all',
  state.minScore!==0 || state.maxScore!==100,state.comparison!=='prior'].filter(Boolean).length;

function filters(state,draft,report,today,open) {
  const choices = report?.options || {};
  const fields = {...state,...draft};
  const preset = [7,30,90].find(n=>state.from===addDays(today,-n) && state.to===addDays(today,-1));
  const count = activeFilters(state);
  return `<form class="bo-card cv-filters" data-cv-form>
    <div class="cv-toolbar">
      ${segments('data-cv-period',[[7,'7 днів'],[30,'30 днів'],[90,'90 днів']],preset,'Період')}
      <span class="cv-range">${rangeLabel(state)}</span>
      <button type="button" class="cv-control" data-cv-toggle-filters aria-controls="cv-filters" aria-expanded="${open}">Фільтри${count?' · '+count:''}</button>
    </div>
    <div id="cv-filters" data-cv-filters ${open?'':'hidden'}>
      <div class="cv-dimensions">
        <label>Початок<input type="date" name="from" max="${addDays(today,-1)}" required value="${escape(fields.from)}"></label>
        <label>Кінець<input type="date" name="to" max="${addDays(today,-1)}" required value="${escape(fields.to)}"></label>
        ${select('comparison','Порівняння',[['prior','Попередній період'],['year','Минулого року']],fields.comparison)}
        <label class="cv-search">Пошук товару<input type="search" name="search" value="${escape(fields.search)}" maxlength="160" placeholder="Код, артикул або назва"></label>
        ${select('root','Категорія',labels(choices.roots,fields.root),fields.root)}
        ${select('category','Підкатегорія',labels(choices.categories,fields.category),fields.category)}
        ${select('brand','Бренд',labels(choices.brands,fields.brand),fields.brand)}
        ${select('price','Ціна',[['all','Усі'],...contentPriceBands],fields.price)}
        ${select('stock','Наявність',[['all','Усі'],['in','Є в наявності'],['out','Немає в наявності'],['unknown','Невідомо']],fields.stock)}
        ${select('promo','Акції',[['all','Усі'],['yes','Акційний'],['no','Неакційний'],['unknown','Невідомо']],fields.promo)}
        ${select('device','Пристрій',contentDevices,fields.device)}
        ${select('source','Залучення',contentSources,fields.source)}
        <label>Content Score від<input type="number" name="minScore" min="0" max="100" value="${escape(fields.minScore)}"></label>
        <label>Content Score до<input type="number" name="maxScore" min="0" max="100" value="${escape(fields.maxScore)}"></label>
      </div>
      <div class="cv-filter-actions">
        <small>${report ? 'Порівняння · '+rangeLabel(report.previous) : ''}</small>
        <button type="button" class="cv-control" data-cv-reset>Скинути</button>
        <button type="submit" class="cv-control cv-primary">Застосувати</button>
      </div>
      <p class="cv-form-error" data-cv-form-error role="alert" hidden></p>
    </div>
  </form>`;
}

function kpis(report) {
  const {current,baseline,complete} = report;
  const scoreSample = `${fmt(current.count)} SKU з оцінкою`;
  const cards = [
    ['Content Score',current.mean,baseline.mean,fmt,'б.', 'Середній бал серед SKU з оцінкою.',
      current.date ? `Знімок ${day(current.date)} · ${scoreSample}` : 'За період немає знімка'],
    ['PDP → Кошик',current.atcRate,complete ? baseline.atcRate : null,pc,'п.п.',
      'Частка SKU-сесій, у яких товар додали до кошика після перегляду.',
      `${fmt(current.atc)} / ${fmt(current.sessions)} SKU-сесій`],
    ['PDP → Покупка',current.purchaseRate,complete ? baseline.purchaseRate : null,pc,'п.п.',
      'Частка SKU-сесій, у яких товар купили після перегляду.',
      `${fmt(current.purchaseSessions)} / ${fmt(current.sessions)} SKU-сесій`],
    ['SKU з оцінкою ≥ 80',current.share,baseline.share,pc,'п.п.',
      'Частка SKU з оцінкою від 80 балів серед товарів з оцінкою.',
      `${fmt(current.high)} із ${fmt(current.count)} SKU`],
  ];
  return `<div class="bo-card cv-kpis" aria-label="Ключові показники">${cards.map(([label,value,previous,format,unit,formula,context],index) => {
    const move = diff(value,previous);
    const tone = move > 0 ? 'cv-positive' : move < 0 ? 'cv-negative' : '';
    return `<section class="cv-kpi"><h2>${label} <span tabindex="0" title="${escape(formula+' '+context)}" aria-label="${escape(formula+' '+context)}" class="cv-help">ⓘ</span></h2>
      <strong>${format(value)}${index===0&&value!==null?'<small> / 100</small>':''}</strong>
      <div class="cv-kpi-context">${move===null?context:`<b class="${tone}">${signed(move,unit)}</b> <span>· було ${format(previous)}</span>`}</div></section>`;
  }).join('')}</div>`;
}

const groupNote = row => `${row.label} · ${fmt(row.skus)} SKU · ${fmt(row.sessions)} сесій · ${fmt(row.views)} переглядів · Кошик ${pc(row.atcRate)} · Покупка ${pc(row.purchaseRate)} · ${fmt(row.purchases)} покупок · ${uah(row.revenue)}${row.sessions > 0 && row.sessions < minimumContentSample ? ' · Мала вибірка' : ''}`;
function chartScale(peak) {
  if (!Number.isFinite(peak) || peak <= 0) return 1;
  const unit = 10**Math.floor(Math.log10(peak));
  return [1,2,2.5,5,10].find(n=>n*unit >= peak)*unit;
}

function bars(rows,table,metric,bucket,improvedVisible) {
  const max = Math.max(0,...rows.map(row=>row[metric] ?? 0));
  const mark = value => metric === 'revenue' ? (value == null ? '—' : fmt(value,compact)+' ₴') : pc(value);
  const hasTraffic = rows.some(row=>row.sessions > 0);
  const hasSku = rows.some(row=>row.skus > 0);
  const message = table === 'attributes' && !hasSku
    ? 'Для цього асортименту немає підтверджених даних про обов’язкові характеристики.'
    : table === 'score' && !hasTraffic ? 'За вибрані дати немає збігу денних оцінок із GA4-сесіями.'
      : 'Для цього зрізу немає значень вибраної метрики.';
  return `<section class="bo-card cv-panel" aria-labelledby="cv-chart-title">
    <div class="cv-panel-head"><div><h2 id="cv-chart-title">${table==='score'?'Конверсія за Content Score':titles[table]+' × Конверсія'}</h2>
      <p>${table==='score'?'Оцінка на дату перегляду':'Стан за останнім знімком каталогу'}</p></div>
      ${segments('data-cv-metric',Object.entries(metrics),metric,'Метрика графіка')}</div>
    ${rows.every(row=>row[metric]===null) ? `<p class="cv-empty">${message}</p>` : `<div class="cv-chart" aria-label="Групи товарів">
      ${rows.map((row,index)=>{
        const value = row[metric];
        const width = max > 0 && value > 0 ? value/max*100 : 0;
        const low = row.sessions > 0 && row.sessions < minimumContentSample;
        const summary = escape(groupNote(row));
        return `<button type="button" class="cv-column" data-cv-bucket="${index}" aria-pressed="${String(index)===bucket}"
          aria-label="${summary}. Показати товари" title="${summary}">
          <span class="cv-bucket-label">${row.label}</span>
          <span class="cv-bar-area" aria-hidden="true"><i class="cv-bar" style="--value:${width}%"></i></span>
          <strong class="cv-bar-value">${mark(value)}</strong>
          <small class="cv-sample">${fmt(row.sessions)} <span>сесій</span>${low?'<span class="cv-small-sample" aria-hidden="true"> · мало</span>':''}</small>
        </button>`;
      }).join('')}</div>`}
    <div class="cv-chart-footer">
      <small>${hasTraffic?'Натисніть на групу, щоб відкрити товари.':''}</small>
      <button type="button" class="cv-control" data-cv-improved aria-expanded="${improvedVisible}">Покращені SKU</button>
    </div>
  </section>`;
}

function trend(report) {
  const points = report.daily;
  if (!points.some(point=>point.score!==null || point.purchaseRate!==null)) return '';
  const maxCR = chartScale(Math.max(0,...points.map(point=>point.purchaseRate ?? 0)));
  const left = 58, right = 694, top = 19, bottom = 141;
  const x = i => points.length===1 ? (left+right)/2 : left+(right-left)*i/(points.length-1);
  const plot = (key,max) => {
    let restart = true;
    return points.map((point,i) => {
      if (point[key] === null) { restart=true; return ''; }
      const y = bottom-(bottom-top)*point[key]/max;
      const data = `<circle cx="${x(i)}" cy="${y}" r="2.5"><title>${day(point.date)} · ${key==='score'?fmt(point[key])+' б.':pc(point[key])}</title></circle>`;
      const line = restart ? '' : `<line x1="${x(i-1)}" y1="${bottom-(bottom-top)*points[i-1][key]/max}" x2="${x(i)}" y2="${y}" />`;
      restart=false;
      return line+data;
    }).join('');
  };
  const ticks = [...new Set([0,Math.floor((points.length-1)*.33),Math.floor((points.length-1)*.67),points.length-1])];
  return `<section class="bo-card cv-panel"><div class="cv-panel-head"><div><h2>Content Score і конверсія за днями</h2>
    <p>Оцінка за денним знімком · CR за датою першого PDP у сесії</p></div></div>
    <div class="cv-chart-scroll"><svg class="cv-trend" viewBox="0 0 756 172" role="img" aria-label="Графік Content Score та PDP → Purchase за днями">
      ${[0,.25,.5,.75,1].map(value=>{const y=bottom-(bottom-top)*value;return `<path d="M${left} ${y}H${right}"></path><text x="50" y="${y+4}" text-anchor="end">${fmt(100*value)}</text><text x="703" y="${y+4}">${pc(maxCR*value)}</text>`;}).join('')}
      ${ticks.map(i=>`<text x="${x(i)}" y="162" text-anchor="middle">${day(points[i].date).slice(0,5)}</text>`).join('')}
      <g class="cv-trend-score">${plot('score',100)}</g><g class="cv-trend-cr">${plot('purchaseRate',maxCR)}</g>
    </svg></div>
    <div class="cv-legend"><span><i class="cv-bar-atcRate"></i>Content Score · ліва вісь</span><span><i class="cv-bar-purchaseRate"></i>PDP → Purchase · права вісь</span></div>
  </section>`;
}

const commonColumns = [['name','Товар'],['score','Content Score'],['sessions','PDP-сесії'],['views','Перегляди'],
  ['atcRate','PDP → ATC'],['purchaseRate','PDP → Purchase'],['purchases','Покупки SKU'],['revenue','Дохід GA4']];
const erpColumns = [['shipmentOrders','Відвантаження ERP'],['shipmentRevenue','Виторг ERP']];
const historyColumns = [['name','Товар'],['date','Дата зміни'],['score','Бал до → після'],['pairViews','PDP до → після'],
  ['pairCr','CR до → після'],['change','Зміна CR'],['pairOrders','Покупки до → після'],['pairMoney','Дохід GA4 до → після'],['adjusted','Відносно контролю']];
const improvedColumns = [['name','Товар'],['date','Дата покращення'],['score','Бал до → після'],
  ['windows','Вікна до / після'],['samples','PDP-сесії'],['atcChange','Кошик'],['change','Покупка'],['pairOrders','Покупки']];
const opportunityColumns = [['name','Товар'],['score','Content Score'],['sessions','PDP-сесії'],['purchaseRate','Поточний CR'],
  ['target','Медіанний CR'],['gap','Різниця CR'],['missing','Що доповнити'],['potentialOrders','Додаткові покупки'],['potentialRevenue','Додатковий дохід']];
const componentColumn = {photos:['photos','Фото'],attributes:['attributes','Заповненість'],reviews:['reviews','Відгуки']};
const sortable = new Set(contentSorts);
const shortRange = range => `${day(range.from).slice(0,5)}–${day(range.to).slice(0,5)}`;
function comparisonCell(value,before,after) {
  const label = value > 0 ? 'cv-positive' : value < 0 ? 'cv-negative' : '';
  const amount = value !== 0 && Math.abs(value) < .01 ? fmt(value,preciseNumber) : fmt(value);
  return `<strong class="${label}">${value > 0?'+':''}${amount} п.п.</strong><small>${combine(before,after,pc)}</small>`;
}
function cells(row,table) {
  const name = `<strong>${escape(row.name)}</strong><small>${escape(row.code)} · ${escape(row.category)}${row.brand?' · '+escape(row.brand):''}</small>`;
  if (table==='improved') {
    const smallSample = Math.min(row.before.sessions,row.after.sessions) < minimumContentSample;
    return [name,day(row.date),combine(row.scoreBefore,row.score),
      `<span title="${rangeLabel(row.beforeRange)} / ${rangeLabel(row.afterRange)}">${shortRange(row.beforeRange)}<br>${shortRange(row.afterRange)}</span><small>По ${fmt(row.windowDays)} дн.</small>`,
      combine(row.before.sessions,row.after.sessions)+(smallSample?'<small>Мала вибірка</small>':''),
      comparisonCell(row.atcChange,row.before.atcRate,row.after.atcRate),
      comparisonCell(row.change,row.before.purchaseRate,row.after.purchaseRate),combine(row.before.purchases,row.after.purchases)];
  }
  if (table==='history') return [name,day(row.date),combine(row.scoreBefore,row.score),
    combine(row.before?.views,row.after?.views),combine(row.before?.purchaseRate,row.after?.purchaseRate,pc),
    signed(row.change,'п.п.'),combine(row.before?.purchases,row.after?.purchases),combine(row.before?.revenue,row.after?.revenue,uah),
    row.control?`${signed(row.adjusted,'п.п.')}<small>${fmt(row.control.count)} SKU в контролі</small>`:'—'];
  if (table==='opportunity') return [name,fmt(row.score),fmt(row.sessions),pc(row.purchaseRate),pc(row.target)+`<small>${fmt(row.peers)} SKU</small>`,
    signed(row.gap,'п.п.'),`<span class="cv-missing">${row.missing.map(escape).join(' · ')}</span>`,fmt(row.potentialOrders),uah(row.potentialRevenue)];
  return [name,fmt(row.score),...(componentColumn[table] ? [(table==='attributes' ? pc : fmt)(row[table])] : []),
    fmt(row.sessions),fmt(row.views),pc(row.atcRate),pc(row.purchaseRate),fmt(row.purchases),uah(row.revenue),
    ...(table==='score' ? [] : [fmt(row.shipmentOrders),uah(row.shipmentRevenue)])];
}
function details(report,state) {
  const {rows,total,size,page} = report.detail;
  const pages = Math.max(1,Math.ceil(total/size));
  const hasGroup = state.bucket !== '';
  const bucket = hasGroup ? report.groups[state.table][Number(state.bucket)].label : '';
  const isImproved = state.table==='improved';
  const columns = isImproved ? improvedColumns : state.table==='history' ? historyColumns : state.table==='opportunity' ? opportunityColumns :
    [...commonColumns.slice(0,2),...(componentColumn[state.table]?[componentColumn[state.table]]:[]),...commonColumns.slice(2),...(state.table==='score'?[]:erpColumns)];
  const head = isImproved ? 'Покращені SKU з результатом' : state.table==='history' ? 'Зміни Content Score' :
    state.table==='opportunity' ? 'Пріоритети контент-команди' : 'Деталізація SKU';
  const description = isImproved ? 'Content Score зріс, а конверсія в кошик або покупку змінилася. Для кожного SKU беремо найдовші однакові вікна до і після, до 7 днів кожне.' :
    state.table==='history' ? `Остання зафіксована зміна SKU. Вікна по 7 днів з обох боків доступні для ${fmt(report.historyExposures)} із ${fmt(total)} SKU.` :
    state.table==='opportunity' ? 'Прогнозний сценарій за медіанною конверсією схожих SKU з оцінкою від 80 балів.' :
      state.table==='score' ? 'Оцінка в групі зважена за SKU-сесіями.' : 'Компоненти контенту взято з останнього знімка каталогу.';
  const empty = isImproved ? improvementEmpty(report.improvements) :
    state.table==='opportunity' ? 'Для цього зрізу немає SKU, які пройшли пороги трафіку та зіставності.' :
    state.table==='history' ? 'У доступних сусідніх знімках за цей період немає змін для вибраних товарів.' :
      'Для вибраної групи або фільтрів немає SKU.';
  return `<section id="cv-detail" class="bo-card cv-panel" aria-labelledby="cv-detail-title">
    <div class="cv-panel-head"><div><h2 id="cv-detail-title" tabindex="-1">${head}${bucket?' · '+bucket:''}</h2><p>${hasGroup?groupNote(report.groups[state.table][Number(state.bucket)]):description}</p></div>
      <div class="cv-tools">${hasGroup?`<button type="button" class="cv-control" data-cv-clear-group>Згорнути</button>`:''}
        <button type="button" class="cv-control" data-cv-export ${total?'':'disabled'}>Експорт Excel</button></div></div>
    ${rows.length ? `<div class="cv-scroll" role="region" tabindex="0" aria-labelledby="cv-detail-title"><table class="cv-table"><thead><tr>${columns.map(([key,label])=>
      `<th scope="col"${key===state.sort ? ` aria-sort="${state.direction==='asc'?'ascending':'descending'}"` : ''}>${sortable.has(key)?
        `<button type="button" data-cv-sort="${key}">${label}${key===state.sort?(state.direction==='asc'?' ↑':' ↓'):''}</button>`:label}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(row=>`<tr>${cells(row,state.table).map((cell,index)=>index===0?`<th scope="row">${cell}</th>`:`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <div class="cv-page"><small>${fmt((page-1)*size+1)}–${fmt(Math.min(page*size,total))} з ${fmt(total)}</small>
      <button type="button" class="cv-control" data-cv-page="${page-1}" ${page<=1?'disabled':''}>Назад</button>
      <button type="button" class="cv-control" data-cv-page="${page+1}" ${page>=pages?'disabled':''}>Далі</button></div>` :
      `<p class="cv-empty" role="status">${empty}</p>`}
    <p class="cv-empty" data-cv-export-status aria-live="polite" hidden></p>
  </section>`;
}

function improvementEmpty({increases=0,comparable=0}={}) {
  if (!increases) return 'За вибраний період немає зафіксованого зростання Content Score.';
  if (!comparable) return `Content Score зріс для ${fmt(increases)} SKU. Потрібні знімки й сесії в обох вікнах, щоб виміряти результат.`;
  return `Конверсію до і після виміряно для ${fmt(comparable)} SKU. У цих порівняннях вона залишилася на тому самому рівні.`;
}

function notices(report,state) {
  const coverage = `GA4 · ${report.coveredCurrent}/${rangeDays(report.range)} дн. · порівняння ${report.coveredPrevious}/${rangeDays(report.previous)} дн. · остання дата ${day(report.lastWebDate)}`;
  const score = `Content Score · ${report.scoreDays}/${rangeDays(report.range)} дн.`;
  const dataWarnings = [
    ...(!report.complete?['Покриття GA4 неповне. Зміни конверсії між періодами приховані.']:[]),
    ...(report.unscored?[ `${fmt(report.unscored)} SKU-сесій не мають балу на дату перегляду.`]:[]),
    ...(report.unmatched?[ `${fmt(report.unmatched)} SKU-сесій GA4 не зв’язано з однозначним товаром у каталозі до застосування товарних фільтрів.`]:[]),
    ...(report.ambiguous?[ `${fmt(report.ambiguous)} записів каталогу мають неоднозначний код товару.`]:[]),
    ...(report.current.incomplete?['Для частини покупок GA4 бракує номера транзакції або суми в UAH. Дохід і непідтверджені покупки не включено.']:[]),
    ...(!report.promoDate?['Знімок акцій недоступний. Акційність товарів позначено як невідому.']:[]),
    ...(!report.erpDate?[state.device!=='all'||state.source!=='all'?'ERP доступний для всіх пристроїв і джерел залучення разом.':'Виторг ERP за період недоступний.']:[]),
  ];
  return `<details class="bo-card cv-notice"><summary>Покриття даних · ${score}</summary>
    <p>${coverage} · Період порівняння ${rangeLabel(report.previous)} · Каталог ${day(report.catalogDate)}${report.promoDate?' · Акції '+day(report.promoDate):''}${report.erpDate?' · ERP '+day(report.erpDate):''}</p>
    ${dataWarnings.length?`<ul>${dataWarnings.map(text=>`<li>${text}</li>`).join('')}</ul>`:''}
    <p>Одиниця аналізу — SKU-сесія. Один сеанс може містити кілька товарів. Події в кошику й покупка враховуються після першого перегляду того самого SKU, у межах сесії та вибраного періоду. У порівнянні до та після сесію відносимо до дати її першого PDP для відповідного SKU. Виручка GA4 — сума товарних рядків покупок у гривнях. ERP — чистий виторг повністю відвантажених товарів за датою відвантаження.${report.erpDate ? ' Виторг ERP у вибраному асортименті '+uah(report.erpRevenue)+'.' : ''}</p>
    <p>Групи Content Score використовують точні денні знімки. Дробові бали зіставляються з верхньою межею кожної групи без округлення. Фільтр балу бере останній знімок у періоді, а категорія, бренд, ціна, наявність, фото, характеристики, відгуки та акції — останній знімок каталогу. Через зміну балу один SKU може потрапити до кількох груп.</p>
    <p>Для покращених SKU остання зміна має підвищувати Content Score. Вікна до і після мають повне покриття та сесії. День зміни пропускаємо. Протягом порівняння враховуємо товари з однією зміною балу.</p>
    <p>Мала вибірка — менше ${minimumContentSample} SKU-сесій. Аналоги зіставляються за категорією, брендом, ціновим діапазоном, наявністю та акційністю з урахуванням вибраного трафіку. Для прогнозу потрібно щонайменше 5 аналогів. Дохід сценарію використовує середню виручку GA4 на покупку SKU в аналогів. Зв’язок між балом і конверсією є спостережуваним.</p>
  </details>`;
}

export function mountContentConversion(root,today) {
  let state = savedSelection || contentSelection(contentDefaults(today),today);
  let activeMetric = savedMetric, report, request, draft = {}, filtersOpen = false, improvedVisible = false;
  let pending = false, failure = '';
  const endpoint = params => '/api/content-conversion?'+new URLSearchParams(params);
  const detailSelection = () => improvedVisible ? {...state,table:'improved',bucket:''} : state;
  const action = (selector,fn) => root.querySelectorAll(selector).forEach(node=>node.addEventListener('click',()=>fn(node)));
  const focus = selector => selector && root.querySelector(selector)?.focus({preventScroll:true});
  const attrs = ['root','category','brand','price','stock','promo','device','source','minScore','maxScore'];
  function draw(focusTarget) {
    const hasChart = groups.includes(state.table);
    const showDetails = !hasChart || state.bucket !== '' || improvedVisible;
    root.innerHTML = `<div class="cv-report" aria-busy="${pending}">
      ${filters(state,draft,report,today,filtersOpen)}
      ${pending ? `<div class="bo-card cv-skeleton cv-kpi-skeleton" aria-hidden="true"></div>
        <div class="bo-card cv-skeleton cv-skeleton-large" role="status">Завантажуємо дані GA4 і каталогу…</div>`
      : failure ? `<section class="bo-card cv-panel" role="alert"><p>${escape(failure)}</p><button type="button" class="cv-control" data-cv-retry>Повторити</button></section>`
      : report ? `${kpis(report)}
        ${segments('data-cv-tab',Object.entries(titles),state.table,'Зрізи контенту')}
        ${hasChart?bars(report.groups[state.table],state.table,activeMetric,state.bucket,improvedVisible):''}
        ${showDetails?details(report,detailSelection()):''}
        ${state.table==='history'?trend(report):''}
        ${notices(report,state)}` : ''}
    </div>`;
    const form = root.querySelector('[data-cv-form]');
    const filterPanel = root.querySelector('[data-cv-filters]');
    form.addEventListener('input',({target})=>{draft[target.name]=target.value;});
    action('[data-cv-toggle-filters]',button=>{
      filtersOpen = !filtersOpen;
      filterPanel.hidden = !filtersOpen;
      button.setAttribute('aria-expanded',String(filtersOpen));
    });
    const apply = (closeFilters,focusTarget) => {
      const fields = Object.fromEntries(new FormData(form));
      if (fields.root!==state.root) {fields.category='';fields.brand='';}
      else if (fields.category!==state.category) fields.brand='';
      update({...state,...fields,bucket:'',page:1},{focusTarget,appliedFilters:true,closeFilters});
    };
    form.addEventListener('submit',event=>{event.preventDefault();apply(true,'[data-cv-toggle-filters]');});
    for (const key of ['root','category']) form.elements[key].addEventListener('change',()=>apply(false,`[name="${key}"]`));
    action('[data-cv-period]',node=>{
      const n = node.dataset.cvPeriod;
      delete draft.from;
      delete draft.to;
      update({...state,from:addDays(today,-Number(n)),to:addDays(today,-1),bucket:'',page:1},
        {focusTarget:`[data-cv-period="${n}"]`});
    });
    action('[data-cv-reset]',()=>update({...contentDefaults(today),table:state.table,sort:state.sort,direction:state.direction},
      {focusTarget:'[data-cv-toggle-filters]',appliedFilters:true,closeFilters:true}));
    action('[data-cv-retry]',()=>load());
    action('[data-cv-tab]',node=>{
      const table = node.dataset.cvTab;
      if (table === state.table) return;
      const sort = table==='history' ? 'date' : table==='opportunity' ? 'potentialRevenue' : 'views';
      improvedVisible = false;
      update({...state,table,sort,bucket:'',page:1,direction:'desc'},{focusTarget:`[data-cv-tab="${table}"]`});
    });
    action('[data-cv-metric]',node=>{
      activeMetric = savedMetric = node.dataset.cvMetric;
      draw(`[data-cv-metric="${activeMetric}"]`);
    });
    action('[data-cv-bucket]',node=>{
      const bucket = state.bucket===node.dataset.cvBucket ? '' : node.dataset.cvBucket;
      const sorting = improvedVisible ? {sort:'views',direction:'desc'} : {};
      improvedVisible = false;
      update({...state,...sorting,bucket,page:1},{
        focusTarget:bucket ? '#cv-detail-title' : `[data-cv-bucket="${node.dataset.cvBucket}"]`,scroll:Boolean(bucket),
      });
    });
    action('[data-cv-improved]',()=>{
      improvedVisible = !improvedVisible;
      update({...state,bucket:'',page:1,sort:improvedVisible?'change':'views',direction:'desc'},{
        focusTarget:improvedVisible?'#cv-detail-title':'[data-cv-improved]',scroll:improvedVisible,
      });
    });
    action('[data-cv-clear-group]',()=>{
      const bucket = state.bucket;
      update({...state,bucket:'',page:1},{focusTarget:`[data-cv-bucket="${bucket}"]`});
    });
    action('[data-cv-sort]',node=>{
      const sort = node.dataset.cvSort, direction = state.sort===sort && state.direction==='desc' ? 'asc' : 'desc';
      update({...state,sort,direction,page:1},{focusTarget:`[data-cv-sort="${sort}"]`});
    });
    action('[data-cv-page]',node=>update({...state,page:node.dataset.cvPage},{focusTarget:'#cv-detail-title'}));
    action('[data-cv-export]',node=>download(node));
    focus(focusTarget);
  }
  function update(next,{focusTarget,scroll=false,appliedFilters=false,closeFilters=false}={}) {
    let validated;
    try { validated=contentSelection(next,today); }
    catch {
      const alert = root.querySelector('[data-cv-form-error]');
      alert.textContent='Перевірте дати (до 90 завершених днів) і діапазон Content Score.';
      alert.hidden=false;
      return;
    }
    const scopeKeys = ['from','to','comparison','search',...attrs];
    const full = scopeKeys.some(key=>state[key]!==validated[key]);
    if (appliedFilters) draft = {};
    if (closeFilters) filtersOpen = false;
    state = savedSelection = validated;
    load({focusTarget,scroll,full});
  }
  async function load({focusTarget,scroll=false,full=true}={}) {
    request?.abort();
    const ticket = request = new AbortController();
    failure='';
    pending=true;
    if (full || !report) draw(focusTarget);
    else {
      root.querySelector('.cv-report')?.setAttribute('aria-busy','true');
      const heading = root.querySelector('#cv-detail-title');
      if (heading) heading.textContent='Завантажуємо деталізацію…';
    }
    try {
      const response = await fetch(endpoint(detailSelection()),{signal:ticket.signal});
      const payload = await response.json();
      if (!response.ok || !payload.available) throw Error(payload.notice || 'Дані звіту тимчасово недоступні.');
      if (ticket!==request || !root.isConnected) return;
      report=payload;
      state.page=payload.detail.page;
      savedSelection=state;
    } catch (error) {
      if (ticket!==request || ticket.signal.aborted || !root.isConnected) return;
      failure=error.message;
    } finally {
      if (ticket===request && !ticket.signal.aborted && root.isConnected) {
        pending=false;
        draw(focusTarget);
        if (scroll) root.querySelector('#cv-detail-title')?.scrollIntoView({block:'nearest'});
      }
    }
  }
  async function download(button) {
    button.disabled=true;
    const status = root.querySelector('[data-cv-export-status]');
    status.hidden=false;
    status.textContent='Готуємо файл Excel…';
    try {
      const response = await fetch(endpoint({...detailSelection(),export:'1'}));
      const data = await response.json();
      if (!response.ok || !data.file) throw Error('export_unavailable');
      const blob = new Blob([Uint8Array.from(atob(data.file),char=>char.charCodeAt(0))],
        {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href=url;link.download=data.filename;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),30_000);
      status.textContent='Файл Excel готовий.';
    } catch {status.textContent='Не вдалося завантажити Excel. Повторіть спробу.';}
    finally {button.disabled=false;}
  }
  load();
}
