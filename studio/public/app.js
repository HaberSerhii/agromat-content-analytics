import {overviewDefaults, overviewControls, validComparison, comparisonRange, scopedSales, scopeKey} from '/overview-filters.mjs?v=funnel-filters';
import {bindComparisonTooltips, renderOverviewFunnel} from "/site-funnel.mjs?v=funnel-filters";
import {bindCategoryTooltips} from "/category-treemap.mjs?v=category-comparison";
import { bindWeeklyCharts } from "/weekly-charts.mjs?v=margin-tooltip";
import { renderBusinessOverview, renderSalesBreakdown, renderCatalogScoreHistory, overviewModel, bindQuarterTooltips, channelMetrics } from "/business-overview.mjs?v=channel-profit";
import { apiParams, createApiCache } from "/api-cache.mjs?v=funnel-filters";
import {
  defaultRange,
  chartSeries,
  yearBefore,
} from "/chart-data.mjs?v=salesfilters1";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const num = (v) =>
    v === null || v === undefined
      ? "—"
      : new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(v),
  money = (v) => (v === null || v === undefined ? "—" : num(v) + " ₴"),
  pct = (v) =>
    v === null || v === undefined
      ? "—"
      : new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(v) +
        "%";
const defs = {
  home: {
    name: "Загальний огляд",
    title: "Уся аналітика.<br>Одна картина.",
    description: "Каталог, ринок і продажі — з ваших реальних джерел.",
    tabs: [["overview", "Огляд"]],
  },
  channels: {
    name: "Канали залучення",
    title: "Канали залучення",
    description: "Сесії, покупки та атрибутована виручка з GA4.",
    tabs: [["overview", "Огляд"]],
  },
  prices: {
    name: "Ціни конкурентів",
    title: "Ринок змінюється.<br>Тримайте фокус.",
    description: "Порівняння цін та співпадіння з поточним фідом.",
    tabs: [
      ["overview", "Матриця цін"],
      ["changed", "Змінили ціну"],
      ["vtm-changed", "Зміни ВТМ"],
      ["not-median", "Поза медіаною"],
      ["vtm-not-median", "ВТМ поза медіаною"],
      ["new-feed", "Нові товари"],
      ["match-changed", "Співпадіння"],
    ],
  },
  products: {
    name: "Товари та контент",
    title: "Сильніший каталог.<br>Кращий результат.",
    description: "Наявність, характеристики та якість карток товарів.",
    tabs: [
      ["overview", "Каталог"],
      ["available", "Є в наявності"],
      ["missing", "Немає в наявності"],
      ["photos", "Без фото"],
      ["attributes", "Без характеристик"],
    ],
  },
  promotions: {
    name: "Акції",
    title: "Пропозиції, що<br>створюють попит.",
    description: "Акційні програми, ціни та готовність товарів до продажу.",
    tabs: [
      ["overview", "Акційні товари"],
      ["programs", "Програми"],
      ["photos", "Без фото"],
      ["attributes", "Незаповнені атрибути"],
    ],
  },
  sales: {
    name: "Продажі",
    title: "Кожен результат.<br>У повній картині.",
    description: "Відвантаження, план, категорії та статуси документів.",
    tabs: [
      ["overview", "Огляд"],
      ["categories", "Категорії"],
      ["brands", "Бренди"],
      ["states", "Статуси"],
      ["cancellations", "Скасування"],
    ],
  },
};
const paths = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  channels: '<path d="M4 20V10M10 20V4M16 20v-8M22 20V7"/>',
  home: '<path d="M3 10 12 3l9 7v10H5V10M9 21v-8h6v8"/>',
  prices: '<path d="M4 17l5-5 4 3 7-10M14 5h6v6M4 4v17h17"/>',
  products:
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  promotions:
    '<path d="M3 4h9l9 9-8 8-10-10V4Z"/><circle cx="8" cy="8" r="1"/>',
  sales: '<path d="M3 4h2l3 12h11l3-9H6M9 21h.01M18 21h.01"/>',
};
const icon = (k) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${paths[k] || paths.products}</svg>`;
const today = new Date().toLocaleDateString("sv-SE", {
  timeZone: "Europe/Kyiv",
});
let section = "home",
  view = "overview",
  state = {
    ...overviewDefaults(today),
    category: "all",
    brand: "all",
    search: "",
    page: 1,
    yoy: true,
    competitor: "all",
    chartChannel: "all",
    ranking: "category",
    chartMetric: "revenue",
    channelMetric: "revenue",
    chartSegment: "Усі",
    chartInterval: "day",
  },
  data = null,
  requestId = 0,
  tableRows = [],
  history = [];
function parseLocation() {
  let [p, q = ""] = location.hash.slice(1).split("?"),
    [s, v] = p.split("/");
  if (s === "home" && v === "channels") {
    s = "channels";
    v = "overview";
  }
  section = defs[s] ? s : "home";
  view = defs[section].tabs.some((t) => t[0] === v) ? v : "overview";
  if (section === 'home' && ['inventory-demand','content-conversion'].includes(v)) view = v;
  let params = new URLSearchParams(q);
  if (section === 'home') Object.assign(state, overviewDefaults(today));
  for (let k of [
    "from",
    "to",
    "category",
    "brand",
    "search",
    "competitor",
    "chartChannel",
    "chartMetric",
    "channelMetric",
    "chartSegment",
    "chartInterval",
    "ranking",
    "compareMode",
    "categoryMeasure",
    "brandMeasure",
    "salesScope",
    "acquisition",
    "device",
  ])
    if (params.has(k)) state[k] = params.get(k);
  for (const [key, allowed, fallback] of [
    ["chartMetric", ["revenue", "margin", "docs", "aov", "users", "conversion", "canceled"], "revenue"],
    ["channelMetric", channelMetrics, "revenue"],
    ["chartInterval", ["day", "week", "month"], "day"],
    ["chartSegment", ["Усі", "Плитка", "Сантехніка", "Підлогові покриття", "Джерела живлення", "Будівельна хімія", "Інше"], "Усі"],
    ['salesScope', ['all','site','marketplaces'], 'all'],
    ['acquisition', ['all','direct','organic','cpc'], 'all'],
    ['device', ['all','mobile','desktop'], 'all'],
  ]) if (!allowed.includes(state[key])) state[key] = fallback;
  state.page = Math.max(1, Number(params.get("page")) || 1);
  state.yoy = params.get("yoy") !== "0";
  if (section === 'home') {
    if (channelMetrics.includes(state.chartMetric)) state.channelMetric = state.chartMetric;
    try { state.compareMode = validComparison(state, state.compareMode);comparisonRange(state,state.compareMode); } catch { Object.assign(state,overviewDefaults(today)); }
    state.yoy = true;
    state.chartChannel = state.salesScope === 'site' ? 'site' : 'all';
  }
}
function saveLocation() {
  let q = new URLSearchParams({ ...state, yoy: state.yoy ? "1" : "0" });
  window.history.replaceState(null, "", "#" + section + "/" + view + "?" + q);
}
function go(s, v = "overview", extra = {}) {
  if (!defs[s]) return;
  let changed = s !== section;
  history.push({ section, view, state: { ...state } });
  section = s;
  view = v;
  state = {
    ...state,
    ...(changed
      ? { category: "all", brand: "all", search: "", competitor: "all" }
      : {}),
    ...extra,
    page: 1,
  };
  window.history.pushState(
    null,
    "",
    "#" +
      s +
      "/" +
      v +
      "?" +
      new URLSearchParams({ ...state, yoy: state.yoy ? "1" : "0" }),
  );
  load();
  window.scrollTo({ top: 0 });
}
window.addEventListener("popstate", () => {
  parseLocation();
  load();
});
const apiCache = createApiCache();
const localPreview = ['localhost','127.0.0.1'].includes(location.hostname);
const sessionApiCache = createApiCache({storage: () => null});
async function api(kind, extra = {}) {
  const cache = kind === 'overview' && localPreview ? sessionApiCache : apiCache;
  return cache.get("/api/" + kind + "?" + apiParams(kind, state, extra));
}
const sourceStatus = new Map();
function sourceTime(value) {
  if (!value) return "час не передано";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value))
    return value
      .split("-")
      .reverse()
      .map((x, i) => (i === 2 ? x.slice(-2) : x))
      .join(".");
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? "час не передано"
    : d
        .toLocaleString("uk-UA", {
          timeZone: "Europe/Kyiv",
          day: "2-digit",
          month: "2-digit",
          year: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
        .replace(",", "");
}
function sourceStatusHTML() {
  const descriptions = {
    GA4: "Сесії, покупки та атрибутована виручка. Час останнього отримання звіту.",
    BigQuery:
      "Унікальні user_pseudo_id за весь вибраний період, Україна. Час останнього отримання агрегату.",
    "API AGROMAT": "Каталог, залишки та контент. Час синхронізації каталогу.",
    "ERP / S3": "Замовлення та відвантаження. Час оновлення файлу джерела.",
    "Моніторинг цін":
      "Ціни конкурентів. Дата поточного знімка; точний час джерело не передає.",
  };
  return `<div class="source-detail-list">${Object.entries(descriptions)
    .map(([name, description]) => {
      const d = sourceStatus.get(name),
        status = d
          ? d.available
            ? "Онлайн"
            : "Недоступно"
          : "Ще не перевірено";
      return `<section class="source-detail"><div><b>${name}</b><span class="source-state ${d?.available ? "ready" : "pending"}">● ${status}</span></div><p>Останнє оновлення: <time>${d?.updatedAt ? sourceTime(d.updatedAt) : "час не передано"}</time></p><small>${description}${d?.dataThrough?` Дані доступні до ${sourceTime(d.dataThrough)}.`:""}</small></section>`;
    })
    .join(
      "",
    )}</div><p class="source-check-note">Статус за останнім запитом дашборда. Час — Київ.</p>`;
}
function sourceBadgeHTML() {
  const rows = [...sourceStatus.values()];
  const status = rows.some((d) => !d.available)
    ? "pending"
    : rows.length
      ? "ready"
      : "unknown";
  return `<i class="${status}" aria-hidden="true">●</i> Live Data`;
}
function updateSources() {
  if (section === "home" && view === "overview") {
    for (const [name, key] of [
      ["GA4", "history"],
      ["BigQuery", "users"],
      ["API AGROMAT", "products"],
      ["ERP / S3", "sales"],
      ["Моніторинг цін", "priceIndex"],
    ])
      if (data[key]) sourceStatus.set(name, data[key]);
  } else {
    const name = {
      channels: "GA4",
      products: "API AGROMAT",
      promotions: "API AGROMAT",
      sales: "ERP / S3",
      prices: "Моніторинг цін",
    }[section];
    if (name) sourceStatus.set(name, data);
  }
  if ($("#live-data-label"))
    $("#live-data-label").innerHTML = sourceBadgeHTML();
  if ($("#source-status-list"))
    $("#source-status-list").innerHTML = sourceStatusHTML();
}
let overviewHeaderObserver;
function syncOverviewHeader() {
  const controls = document.querySelector('.bo-filterbar');
  if (controls) controls.innerHTML = overviewControls(state);
}
function businessShell() {
  const reportNames = {'overview':'Огляд бізнесу','inventory-demand':'Наявність × попит','content-conversion':'Контент × Конверсія'};
  const reportNav = `<section class="bo-nav-group" aria-labelledby="mix-analysis-label"><div class="side-label" id="mix-analysis-label">Мікс-аналіз</div>${Object.entries(reportNames).slice(1).map(([key,label])=>
    `<button class="nav ${view===key?'active':''}" data-view="${key}" ${view===key?'aria-current="page"':''}>${icon(key==='content-conversion'?'channels':'products')}<span>${label}</span></button>`).join('')}</section>`;
  const mobileNav = `<nav class="bo-report-mobile" aria-label="Звіти">${Object.entries(reportNames).map(([key,label])=>
    `<button data-view="${key}" aria-pressed="${view===key}">${label}</button>`).join('')}</nav>`;
  document.body.classList.add('business-page');
  $('#app').innerHTML = `<aside class="bo-sidebar"><a class="logo" href="#home/overview" id="logo-home"><img class="brand-logo" src="/agromat-logo.svg?v=blue" alt="АГРОМАТ" width="175" height="21"><small>ANALYTICS STUDIO</small></a><div class="side-label">РОБОЧИЙ ПРОСТІР</div><button class="nav ${view==='overview'?'active':''}" data-go="home" ${view==='overview'?'aria-current="page"':''}>${icon('overview')}<span>Огляд бізнесу</span></button>${reportNav}<div class="bo-side-bottom"><span class="bo-status-dot"></span> Реальні джерела даних<small>ERP / S3 · GA4 · API · ціни</small><button id="info">Про дані та визначення ↗</button></div></aside><div class="workspace"><main class="bo-main${view==='content-conversion'?' cv-main':''}"><header class="bo-sticky-header"><section class="bo-heading"><h1>${reportNames[view]}<span>.</span></h1>${['localhost','127.0.0.1','::1'].includes(location.hostname)?'<span class="bo-local-label">Локальний перегляд</span>':''}</section>${mobileNav}${view==='overview'?'<div class="bo-filterbar">'+overviewControls(state)+'</div>':''}<div id="bo-overview-notice" class="bo-overview-notice" aria-live="polite"></div></header><div id="filters"></div><div id="content"><div class="loading">Збираємо огляд із реальних джерел…</div></div><footer class="studio-footer"><span>АГРОМАТ · ANALYTICS STUDIO</span><span id="revision">Окремий сервіс · доступ для перегляду</span></footer></main></div>`;
  overviewHeaderObserver?.disconnect();
  overviewHeaderObserver = new ResizeObserver(entries => document.documentElement.style.setProperty('--bo-header-height', Math.ceil(entries[0].target.getBoundingClientRect().height) + 'px'));
  overviewHeaderObserver.observe($('.bo-sticky-header'));
  bindShell();
}

function renderBusiness(options) {
  return renderBusinessOverview(data,{...state,graphToday:today},options);
}
function updateOverviewNotice() {
  const notice = $('#bo-overview-notice');
  if (notice) notice.textContent = data?.scopeNotice ||
    (data?.attribution?.available === false ? data.sourceNotice ?? '' : '');
}
function bindOverviewFunnel() {
  const funnel = $('#bo-funnel');
  if (!funnel) return;
  bindComparisonTooltips('funnel',funnel);
  funnel.querySelectorAll('[data-funnel-filter]').forEach(button => button.onclick = () => {
    const {funnelFilter:key,value} = button.dataset;
    if (state[key] === value || state.salesScope === 'marketplaces') return;
    state[key] = value;
    saveLocation();
    funnel.outerHTML = renderOverviewFunnel(data.siteFunnel,state,data.scopeNotice);
    bindOverviewFunnel();
    $(`#bo-funnel [data-funnel-filter="${key}"][data-value="${value}"]`)?.focus({preventScroll:true});
  });
}
function bindOverviewChart() {
  const chart = $('#bo-revenue');
  bindWeeklyCharts(chart);
  chart.querySelectorAll('[data-bo-interval]').forEach(button => button.onclick = () => {
    state.chartInterval = button.dataset.boInterval;
    saveLocation();
    redrawOverviewChart();
    $(`#bo-revenue [data-bo-interval="${state.chartInterval}"]`)?.focus({preventScroll:true});
  });
}
function redrawOverviewChart() {
  $('#bo-revenue').outerHTML = renderBusiness({panel:'chart'});
  bindOverviewChart();
}
function bindBusinessOverview() {
  if (section !== 'home' || !$(".business-overview")) return;
  bindWeeklyCharts($('.bo-kpis'));
  bindOverviewChart();
  bindQuarterTooltips();
  bindCategoryTooltips();
  bindOverviewFunnel();
  bindComparisonTooltips('catalog');
  $$('[data-catalog-score-history]').forEach(button => button.onclick = () => {
    const catalog = data.catalogHealth;
    const segment = catalog.segments.find(({label}) => label === button.dataset.catalogScoreHistory);
    if (segment?.scoreHistory) modal(`${segment.label} · Щоденний Content Score`, renderCatalogScoreHistory(segment, catalog.scoreStart));
  });
  updateOverviewNotice();
  const render=()=>{ $("#content").innerHTML=renderBusiness(); bindContent(); };
  $$('[data-map][data-measure]').forEach(button => button.onclick = () => {
    const { map, measure } = button.dataset;
    state[map === 'brands' ? 'brandMeasure' : 'categoryMeasure'] = measure;
    saveLocation();
    render();
    $(`[data-map="${map}"][data-measure="${measure}"]`)?.focus({preventScroll:true});
  });
  $$("[data-bo-metric]").forEach(button=>button.onclick=()=>{
    const key=button.dataset.boMetric;
    state.chartMetric=key;
    if (channelMetrics.includes(key)) {
      state.channelMetric=key;
      $('#bo-channels').outerHTML=renderBusiness({panel:'channels'});
    }
    saveLocation();
    $$("[data-bo-metric]").forEach(card=>{
      const selected=card.dataset.boMetric===key;
      card.classList.toggle('selected',selected);
      card.setAttribute('aria-pressed',String(selected));
    });
    redrawOverviewChart();
    $("#bo-revenue").scrollIntoView({behavior:'smooth',block:'nearest'});
  });
  $$("[data-bo-channel]").forEach(button=>button.onclick=()=>{state.chartChannel=button.dataset.boChannel;saveLocation();load({keepView:true});});
  $$("[data-category-meta]").forEach(button=>button.onclick=()=>{
    const tile = JSON.parse(button.dataset.categoryMeta);
    modal(tile.label, renderSalesBreakdown(data.breakdown, tile));
  });

}

function skeleton() {
  if (section === "home" && ["overview","inventory-demand","content-conversion"].includes(view)) return businessShell();
  document.body.classList.remove("business-page");
  const def = defs[section];
  $("#app").innerHTML =
    `<aside><a class="logo" href="#home/overview" id="logo-home"><img class="brand-logo" src="/agromat-logo.svg?v=blue" alt="АГРОМАТ" width="175" height="21"><small>ANALYTICS STUDIO</small></a><div class="side-label">РОБОЧИЙ ПРОСТІР</div>${Object.entries(
      defs,
    )
      .map(
        ([k, d]) =>
          `<button class="nav ${k === section ? "active" : ""}" data-go="${k}" aria-label="${d.name}" ${k === section ? 'aria-current="page"' : ""}>${icon(k)}<span>${d.name}</span></button>`,
      )
      .join(
        "",
      )}<div class="sidehint">Від сигналу.<br>До зрозумілого рішення.</div><div class="profile"><span>A</span><div>АГРОМАТ Studio<small>Реальні джерела даних</small></div></div></aside><div class="workspace"><header class="topbar"><div class="crumb">Робочий простір / <b>${def.name}</b></div><div class="source-status"><button class="icon-btn" id="info" aria-label="Про джерела">ⓘ</button></div></header><main><section class="heading"><div><div class="eyebrow">AGROMAT / ${section === "home" ? "BUSINESS OVERVIEW" : section.toUpperCase() + " INTELLIGENCE"}</div><h1>${view === "overview" ? def.title : def.tabs.find((t) => t[0] === view)[1]}</h1><p>${def.description}</p></div><div class="actions"><div class="dated"><label class="sr" for="date-from">Від</label><input id="date-from" type="date" value="${esc(state.from)}"><span>—</span><label class="sr" for="date-to">До</label><input id="date-to" type="date" value="${esc(state.to)}"><button id="apply-dates">Застосувати</button></div>${["sales", "home", "channels"].includes(section) ? `<button id="toggle-yoy" class="${state.yoy ? "active" : ""}" aria-pressed="${state.yoy}">Порівняння YoY</button>` : ""}</div></section>${def.tabs.length > 1 ? `<nav class="studio-tabs" aria-label="Підрозділи">${def.tabs.map(([v, l]) => `<button data-view="${v}" class="${view === v ? "active" : ""}" ${view === v ? 'aria-current="page"' : ""}>${l}</button>`).join("")}</nav>` : ""}<div id="filters"></div><div id="content"><div class="loading">Завантажуємо дані з джерела…</div></div><footer class="studio-footer"><span>АГРОМАТ · ANALYTICS STUDIO</span><span id="revision">Окремий сервіс · доступ для перегляду</span></footer></main></div>`;
  bindShell();
}
function bindShell() {
  $$("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
  $("#logo-home").onclick = (e) => {
    e.preventDefault();
    go("home");
  };
  $$("[data-view]").forEach(
    (b) => (b.onclick = () => go(section, b.dataset.view)),
  );
  if ($("#apply-dates")) $("#apply-dates").onclick = () => {
    let from = $("#date-from").value,
      to = $("#date-to").value;
    if (
      !from ||
      !to ||
      from > to ||
      (section === "home" && to >= today) ||
      (Date.parse(to) - Date.parse(from)) / 86400000 >= 365
    ) {
      modal(
        "Оберіть коректний період",
        "<p>Початок має бути не пізніше завершення. Максимальний період — 365 днів; для огляду оберіть завершені дні до вчора.</p>",
      );
      return;
    }
    state.from = from;
    state.to = to;
    state.page = 1;
    if (section === 'home') state.compareMode = validComparison(state,state.compareMode);
    saveLocation();
    load();
  };
  $$('[data-comparison]').forEach(button => button.onclick = () => {
    if (button.disabled || state.compareMode === button.dataset.comparison) return;
    state.compareMode = button.dataset.comparison;
    state.yoy = true;
    saveLocation();
    load({keepView:true});
  });
  $$('[data-overview-filter="salesScope"]').forEach(button => button.onclick = () => {
    if (state.salesScope === button.dataset.value) return;
    state.salesScope = button.dataset.value;
    state.chartChannel = state.salesScope === 'site' ? 'site' : 'all';
    state.page = 1;
    saveLocation();
    load({keepView:true});
  });
  if ($("#toggle-yoy"))
    $("#toggle-yoy").onclick = () => {
      state.yoy = !state.yoy;
      saveLocation();
      load();
    };
  $("#info").onclick = () =>
    modal(
      "Джерела та визначення",
      `<div id="source-status-list">${sourceStatusHTML()}</div><p>Каталог та акції — синхронізовані дані Agromat API. Ціни конкурентів — поточний фід системи моніторингу. Продажі — агрегати джерела продажів. Канали — GA4.</p><p>Отримані документи та відвантажений виторг — різні показники. Атрибутована виручка GA4 також не прирівнюється до завершених продажів ERP.</p><p>Демонстраційні підстановки не використовуються. Якщо джерело або історія недоступні, це показано явно. Персональні дані покупців і керування парсерами тут не публікуються.</p>`,
    );
}
async function load({keepView=false}={}) {
  let id = ++requestId;
  const previous=data,preserve=keepView&&section==='home'&&view==='overview'&&previous;
  if(!preserve)skeleton();
  else { syncOverviewHeader(); bindShell(); }
  try {
    if (section === 'home' && view === 'content-conversion') {
      const module = await import('/content-conversion.mjs?v=in-stock');
      if (id === requestId) module.mountContentConversion($('#content'), today);
      return;
    }
    if (section === 'home' && view === 'inventory-demand') {
      const module = await import('/inventory-demand.mjs?v=replenishment1');
      if (id === requestId) module.mountInventoryDemand($('#content'), today);
      return;
    }
    if (section === "home" && view === "overview") {
      const selection = {...state}, range = {from:state.from,to:state.to};
      const baseline = comparisonRange(range, state.compareMode);
      const catalogSnapshot = previous?.priceIndex ? {priceIndex:previous.priceIndex} : {};
      const savedCatalog = previous?.catalogHealth;
      if (savedCatalog?.trafficRange?.from === range.from && savedCatalog.trafficRange.to === range.to &&
          savedCatalog.compareMode === selection.compareMode) catalogSnapshot.catalogHealth = savedCatalog;
      const dashboard = {...catalogSnapshot,salesChannels:{},quarterChannels:{},comparisonRange:baseline,scope:scopeKey(selection),updating:true};
      if (localPreview) dashboard.margin = {amount:null,percent:null};
      data = dashboard;
      let paintQueued = false;
      const draw = () => {
        if (id !== requestId || data !== dashboard || paintQueued) return;
        paintQueued = true;
        requestAnimationFrame(() => {
          paintQueued = false;
          if (id !== requestId || data !== dashboard) return;
          dashboard.chartSales = scopedSales(dashboard.sales,dashboard.salesChannels,selection.salesScope);
          $('#content').innerHTML = renderBusiness(); updateSources(); bindContent();
        });
      };
      const read = (kind,extra={}) => api(kind,extra).catch(() => ({available:false}));
      const catalogJobs = [
        (async()=>{dashboard.catalogHealth=await read('catalog-health', selection);draw();})(),
        (async()=>{dashboard.priceIndex=await read('price-index');draw();})(),
      ];
      draw();
      const overview = await read('overview',selection);
      if (id !== requestId) return;
      if (overview.available) Object.assign(dashboard,overview);
      else {
        dashboard.scopeNotice = overview.notice;
        dashboard.sales = {available:false};
        dashboard.salesChannels = Object.fromEntries(['site','rozetka','monomarket'].map(channel=>[channel,{available:false}]));
      }

      if (id !== requestId) return;
      delete dashboard.updating; draw();
      await Promise.all(catalogJobs);
      if (id !== requestId) return;
      draw();
    } else {
      let kind = section,
        extra = {};
      if (section === "products") {
        if (view === "available") extra.stock = "available";
        if (view === "missing") extra.stock = "missing";
        if (["photos", "attributes"].includes(view)) extra.quality = view;
      }
      if (section === "promotions" && ["photos", "attributes"].includes(view))
        extra.quality = view;
      if (section === "prices") {
        extra.view = view;
        extra.overview = "1";
      }
      let result = await api(kind, extra);
      if (id !== requestId) return;
      data = result;
      if (!data.available) {
        $("#content").innerHTML =
          warning(data.notice) +
          `<button class="secondary error-action" id="retry">Спробувати ще раз</button>`;
        $("#retry").onclick = load;
        return;
      }
      $("#filters").innerHTML = filters(data);
      $("#content").innerHTML =
        section === "sales"
          ? salesView(data)
          : section === "channels"
            ? channelsView(data)
            : section === "prices"
              ? pricesView(data)
              : section === "promotions"
                ? promotionsView(data)
                : productsView(data);
      bindFilters(data);
    }
    if (id !== requestId) return;
    updateSources();
    bindContent();
    let rev = data.revision || data.sales?.revision;
    if (rev) $("#revision").textContent = "Окремий сервіс · " + rev.slice(0, 8);
  } catch {
    if (id === requestId)
      $("#content").innerHTML = warning(
        "З’єднання перервано. Оновіть сторінку або повторіть запит.",
      );
  }
}
function warning(s) {
  return `<div class="source-warning">${esc(s || "Джерело недоступне.")}</div>`;
}
function timestamp(v) {
  if (!v) return "Час оновлення не передано";
  let d = new Date(v);
  return Number.isNaN(d.getTime())
    ? esc(v)
    : d.toLocaleString("uk-UA", {
        timeZone: "Europe/Kyiv",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}
function kpi(label, value, note = "", action = "", previous = null) {
  let delta =
    previous !== null &&
    previous !== undefined &&
    previous > 0 &&
    value !== null
      ? (value / previous - 1) * 100
      : null;
  let formatted = typeof value === "string" ? value : num(value);
  return `<button class="stat ${action ? "hover-stat" : ""}" ${action ? `data-action="${esc(action)}"` : `data-metric="${esc(label)}"`}><div class="statlabel">${label}<span>↗</span></div><strong>${formatted}</strong><small>${esc(note)}</small>${state.yoy && previous !== null ? `<span class="stat-yoy ${delta === null ? "muted" : delta >= 0 ? "good" : "bad"}">${delta === null ? "Немає порівнюваної бази" : (delta > 0 ? "+" : "") + pct(delta) + " YoY"}</span>` : ""}</button>`;
}
function kpis(cards) {
  return `<div class="stats live-kpis">${cards.join("")}</div>`;
}
function panel(title, sub, body, controls = "") {
  return `<section class="panel"><div class="panelhead"><div><h2>${title}</h2><p>${sub || ""}</p></div>${controls}</div>${body}</section>`;
}
function bars(rows, measure = "revenue", kind = "") {
  const max = Math.max(...rows.map((r) => Number(r[measure]) || 0), 1);
  return `<div class="live-bars">${
    [...rows]
      .sort((a, b) => (Number(b[measure]) || 0) - (Number(a[measure]) || 0))
      .slice(0, 12)
      .map(
        (r) =>
          `<button ${kind ? `data-dimension="${kind}" data-value="${esc(r.label)}"` : `data-bucket="${esc(r.label || r.state || r.reason)}"`}><div><span>${esc(r.label || r.state || r.reason || "—")}</span><strong>${measure === "revenue" ? money(r[measure]) : num(r[measure])}</strong></div><i style="width:${(Math.max(0, Number(r[measure]) || 0) / max) * 100}%"></i></button>`,
      )
      .join("") || '<p class="empty">Даних у цій вибірці немає.</p>'
  }</div>`;
}
function monotone(points) {
  if (!points.length) return "";
  if (points.length === 1) return "M" + points[0].join(",");
  let ds = points
      .slice(1)
      .map((p, i) => (p[1] - points[i][1]) / (p[0] - points[i][0])),
    m = points.map((p, i) =>
      !i
        ? ds[0]
        : i === points.length - 1
          ? ds[i - 1]
          : ds[i] * ds[i - 1] <= 0
            ? 0
            : 2 / (1 / ds[i - 1] + 1 / ds[i]),
    );
  return (
    "M" +
    points[0].join(",") +
    points
      .slice(1)
      .map((p, i) => {
        let h = (p[0] - points[i][0]) / 3;
        return ` C${points[i][0] + h},${points[i][1] + h * m[i]} ${p[0] - h},${p[1] - h * m[i + 1]} ${p[0]},${p[1]}`;
      })
      .join("")
  );
}
const chartFilters = [
  ["chartChannel", "Канал продажів", [["all", "Усі канали"], ["site", "Сайт"], ["monomarket", "Monomarket"], ["rozetka", "Rozetka"], ["prom", "Prom"]]],
  ["chartMetric", "Показник", [["revenue", "Продажі, грн"], ["docs", "Замовлення"]]],
  ["chartSegment", "Сегмент", ["Усі", "Плитка", "Сантехніка", "Підлогові покриття", "Джерела живлення", "Будівельна хімія", "Інше"].map(value => [value, value === "Усі" ? "Усі сегменти" : value])],
  ["chartInterval", "Періодичність", [["day", "За днями"], ["week", "За тижнями"], ["month", "За місяцями"]]],
];
function chartControl() {
  const summary = chartFilters.map(([key, , options]) => options.find(([value]) => value === state[key])?.[1] || options[0][1]).join(" · ");
  return `<details class="chart-filters"><summary aria-label="Налаштування графіка">⚙ ${esc(summary)}</summary><div class="chart-filter-popover">${chartFilters.map(([key, label, options]) => `<fieldset><legend>${label}</legend><div class="chart-filter-options">${options.map(([value, name]) => `<button type="button" aria-label="${esc(name)}" data-chart-filter="${key}" data-chart-value="${esc(value)}" aria-pressed="${state[key] === value}">${esc(name)}</button>`).join("")}</div></fieldset>`).join("")}<p>Налаштування змінюють графік і продажі за категоріями та брендами.</p></div></details>`;
}
function rankingPanel(d) {
  const brand = state.ranking === "brand";
  return panel(
    state.chartMetric === "docs"
      ? brand ? "Замовлення за брендами" : "Замовлення за категоріями"
      : brand ? "Продажі за брендами" : "Продажі за категоріями",
    "Лише відвантажені замовлення",
    state.chartChannel === "prom"
      ? '<p class="empty">Джерело продажів поки не виділяє канал Prom.</p>'
      : !d?.available
        ? '<p class="empty">Дані вибраного каналу недоступні.</p>'
        : bars(
      brand ? d?.brands || [] : d?.categories || [],
      state.chartMetric === "docs" ? "docs" : "revenue",
      brand ? "brand" : "category",
    ),
    `<select id="sales-ranking" aria-label="Групування продажів"><option value="category" ${!brand ? "selected" : ""}>Категорії</option><option value="brand" ${brand ? "selected" : ""}>Бренди</option></select>`,
  );
}
let chartRequest = 0, chartFilterOpen = false;
async function updateOverviewChart() {
  const pageRequest = requestId,
    id = ++chartRequest,
    target = $("#overview-sales-chart");
  if (!target) return;
  if ($(".business-overview")) {
    const source = await api("sales", {channel:state.chartChannel,segment:state.chartSegment}).catch(()=>({available:false}));
    if (id !== chartRequest || pageRequest !== requestId) return;
    data.chartSales=source;
    $("#content").innerHTML=renderBusiness();bindContent();return;
  }
  if (state.chartChannel === "prom") {
    data.chartSales = null;
    target.innerHTML = salesChart(null);
    $("#overview-sales-ranking").innerHTML = rankingPanel(null);
    bindContent();
    return;
  }
  target.innerHTML = panel(
    "Динаміка відвантажень",
    "Завантажуємо вибраний канал…",
    '<div class="loading">Завантаження…</div>',
    chartControl(),
  );
  data.chartSales = null;
  $("#overview-sales-ranking").innerHTML = panel("Продажі за категоріями та брендами", "Вибраний канал", '<div class="loading">Завантаження…</div>');
  bindOverviewControls();
  const result =
    await api("sales", { channel: state.chartChannel, segment: state.chartSegment }).catch(() => ({ available: false }));
  if (
    id !== chartRequest ||
    pageRequest !== requestId ||
    !$("#overview-sales-chart")
  )
    return;
  data.chartSales = result;
  $("#overview-sales-chart").innerHTML = salesChart(result);
  $("#overview-sales-ranking").innerHTML = rankingPanel(result);
  bindContent();
}
function bindOverviewControls() {
  const filters = $(".chart-filters");
  if (filters) {
    filters.open = chartFilterOpen;
    filters.ontoggle = () => { chartFilterOpen = filters.open; };
  }
  $$("[data-chart-filter]").forEach(button => {
    button.onclick = () => {
      chartFilterOpen = true;
      state[button.dataset.chartFilter] = button.dataset.chartValue;
      saveLocation();
      if ($(".business-overview") && button.dataset.chartFilter === "chartMetric") {
        $("#content").innerHTML=renderBusiness();bindContent();
      } else if (button.dataset.chartFilter === "chartMetric") {
        $("#overview-sales-chart").innerHTML = salesChart(data.chartSales);
        $("#overview-sales-ranking").innerHTML = rankingPanel(data.chartSales);
        bindContent();
      } else updateOverviewChart();
    };
  });
  if ($("#sales-ranking"))
    $("#sales-ranking").onchange = (e) => {
      state.ranking = e.target.value;
      saveLocation();
      $("#overview-sales-ranking").innerHTML = rankingPanel(data.chartSales);
      bindContent();
    };
}
function salesChart(d) {
  const control = section === "home" ? chartControl() : "";
  if (section === "home" && state.chartChannel === "prom")
    return panel(
      "Динаміка відвантажень",
      "Prom",
      '<p class="empty">Джерело продажів поки не виділяє канал Prom. Дані за іншими каналами не підставляються.</p>',
      control,
    );
  if (!d?.available)
    return panel(
      "Динаміка відвантажень",
      "Джерело тимчасово недоступне",
      '<p class="empty">Не вдалося завантажити вибраний канал.</p>',
      control,
    );
  const formatValue = state.chartMetric === "docs" ? num : money;
  const { interval, rows } = chartSeries(d, state, state.yoy);
  if (!rows.length || d.seriesUnavailable)
    return panel(
      "Динаміка відвантажень",
      "Реальні дані продажів",
      '<p class="empty">Не вдалося отримати повний ряд даних за цей період.</p>',
      control,
    );
  const vals = rows.map((r) => r.value),
    hasPrior = rows[0].previous !== null,
    prior = hasPrior ? rows.map((r) => r.previous) : null;
  const max = Math.max(...vals, ...(prior || []), 1),
    coords = (a) =>
      a.map((v, i) => [
        40 + (i * 620) / Math.max(1, a.length - 1),
        180 - (v / max) * 150,
      ]);
  const points = coords(vals),
    line = monotone(points);
  const marks = points
    .map((p, i) => {
      const r = rows[i],
        delta = r.previous > 0 ? (r.value / r.previous - 1) * 100 : null;
      const change =
        r.previous === null
          ? "Історія недоступна"
          : delta === null
            ? "База торік — 0; зміна не визначена"
            : `${delta > 0 ? "+" : ""}${pct(delta)}`;
      const currentYear = r.from.slice(0, 4),
        previousYear = yearBefore(r.from).slice(0, 4);
      const title = `${currentYear}: ${formatValue(r.value)}${state.yoy ? ` · ${previousYear}: ${r.previous === null ? "немає даних" : formatValue(r.previous)} · ${change}` : ""}`;
      return `<g class="chart-point" tabindex="0" role="img" aria-label="${esc(title)}"><circle cx="${p[0]}" cy="${p[1]}" r="12" fill="transparent"/><circle cx="${p[0]}" cy="${p[1]}" r="2" fill="#fff" stroke="#533afd"/><foreignObject class="chart-tooltip" x="${Math.min(430, Math.max(40, p[0] - 120))}" y="${Math.max(0, p[1] - 95)}" width="225" height="92"><div xmlns="http://www.w3.org/1999/xhtml"><strong>${currentYear}: ${formatValue(r.value)}</strong>${state.yoy ? `<strong>${previousYear}: ${r.previous === null ? "немає даних" : formatValue(r.previous)}</strong><b class="${delta === null ? "muted" : delta >= 0 ? "good" : "bad"}">${esc(change)}</b>` : ""}</div></foreignObject></g>`;
    })
    .join("");
  const tickCount = interval === "week" ? 3 : 5;
  const tickIndices = new Set(
    Array.from({ length: Math.min(tickCount, rows.length) }, (_, j) =>
      Math.round(
        (j * (rows.length - 1)) /
          Math.max(1, Math.min(tickCount, rows.length) - 1),
      ),
    ),
  );
  const ticks = rows
    .map((r, i) =>
      tickIndices.has(i)
        ? `<text x="${points[i][0]}" y="205" text-anchor="${i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"}" font-size="8" fill="#65758d">${esc(r.label)}</text>`
        : "",
    )
    .join("");
  return panel(
    state.chartMetric === "docs" ? "Динаміка відвантажених замовлень" : "Динаміка відвантажень",
    { day: "Денні", week: "Тижневі", month: "Місячні" }[interval] +
      " інтервали вибраного періоду",
    `<div class="live-chart"><svg viewBox="0 0 680 215" role="img" aria-label="Динаміка відвантажень"><defs><linearGradient id="fade" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#533afd" stop-opacity=".15"/><stop offset="1" stop-color="#533afd" stop-opacity="0"/></linearGradient></defs>${[30, 80, 130, 180].map((y, i) => `<path d="M40 ${y}H660" stroke="#e5edf5" stroke-dasharray="3 5"/><text x="32" y="${y + 3}" text-anchor="end" font-size="8" fill="#8a94a5">${state.chartMetric === "docs" ? num(Math.round(max * (1 - i / 3))) : num((max * (1 - i / 3)) / 1000) + "к"}</text>`).join("")}<path d="${line} L${points.at(-1)[0]} 180 L40 180Z" fill="url(#fade)"/>${prior ? `<path d="${monotone(coords(prior))}" fill="none" stroke="#9ca8bc" stroke-width="2" stroke-dasharray="5 5"/>` : ""}<path d="${line}" fill="none" stroke="#533afd" stroke-width="2.5"/>${ticks}${marks}</svg><div class="chart-legend"><b>● Поточний період</b>${hasPrior ? '<span class="old">┄ Ті самі дати торік</span>' : state.yoy ? "<span>Історія за попередній рік відсутня у відповіді джерела</span>" : ""}</div></div>`,
    control,
  );
}
function overviewCard(
  label,
  value,
  note,
  action,
  previous,
  format = num,
  comparison = "Торік",
  lowerIsBetter = false,
) {
  let html = kpi(
    label,
    value === null ? null : format(value),
    "",
    action,
  ).replace("<small></small>", "");
  if (!state.yoy) return html;
  const valid = typeof previous === "number" && Number.isFinite(previous),
    delta =
      valid && previous > 0 && value !== null
        ? (value / previous - 1) * 100
        : null;
  const baseline = valid ? format(previous) : "немає історії";
  const change =
    delta === null
      ? valid
        ? "зміна н/д"
        : "—"
      : `${delta > 0 ? "+" : ""}${pct(delta)}`;
  return html.replace(
    "</button>",
    `<div class="kpi-comparison"><span>${esc(comparison)}: ${esc(baseline)}</span><b class="${delta === null ? "muted" : (lowerIsBetter ? delta <= 0 : delta >= 0) ? "good" : "bad"}">${esc(change)}</b></div></button>`,
  );
}
function overview(d) {
  const ok = (x) => x?.available,
    m = ok(d.sales) ? d.sales.metrics : {},
    p =
      state.yoy && ok(d.sales.previous) && d.sales.previous.hasData
        ? d.sales.previous.metrics
        : {};
  const rate = (x) =>
    ok(x)
      ? (() => {
          let sessions = x.rows.reduce((n, r) => n + r.sessions, 0);
          return sessions > 0
            ? (x.rows.reduce((n, r) => n + r.purchases, 0) / sessions) * 100
            : null;
        })()
      : null;
  const priorStock =
    ok(d.stock.previous) && d.stock.previous.historyAvailable
      ? d.stock.previous.total
      : null;
  const aov = (x) =>
    x.shippedDocs > 0 ? x.shippedRevenue / x.shippedDocs : null;
  const score = ok(d.content) ? d.content.score : null;
  return [
    !ok(d.sales) ? warning("Продажі: джерело недоступне.") : "",
    kpis([
      overviewCard(
        "Відвантажений виторг",
        m.shippedRevenue ?? null,
        "За вибраний період",
        "sales/overview",
        p.shippedRevenue,
        money,
      ),
      overviewCard(
        "Отримані замовлення",
        m.receivedDocs ?? null,
        "За датою створення · ERP",
        "sales/overview",
        p.receivedDocs,
      ),
      overviewCard(
        "Скасовані замовлення",
        m.canceledDocs ?? null,
        "За вибраний період · ERP",
        "sales/cancellations",
        p.canceledDocs,
        num,
        "Торік",
        true,
      ),
      overviewCard(
        "Content Score",
        score,
        "Поточна середня оцінка контенту каталогу",
        "products/overview",
        d.content.previousScore,
        (x) => num(x) + " / 100",
        d.content.previousDate
          ? "Попер. місяць · " +
              d.content.previousDate.split("-").reverse().join(".")
          : "Попер. місяць",
      ),
      overviewCard(
        "Користувачі",
        d.users?.available ? d.users.users : null,
        "Унікальні користувачі · BigQuery · Україна",
        "channels/overview",
        d.users?.previous?.available && d.users.previous.hasData
          ? d.users.previous.users
          : null,
        num,
        d.users?.dataThrough && d.users.dataThrough < state.to ? "Торік · до " + d.users.dataThrough.slice(5).split("-").reverse().join(".") : "Торік",
      ),
      overviewCard(
        "AOV",
        aov(m),
        "Відвантажений виторг / відвантажені замовлення",
        "sales/overview",
        aov(p),
        money,
      ),
      overviewCard(
        "CR",
        rate(d.channels),
        "Покупки / сесії · GA4",
        "channels/overview",
        rate(d.channels.previous),
        pct,
      ),
      overviewCard(
        "Товарів в наявності",
        ok(d.stock) ? d.stock.total : null,
        "SKU із залишком ≥ 1 · поточний каталог",
        "products/available",
        priorStock,
      ),
    ]),
    ok(d.sales)
      ? `<div class="grid">${`<div id="overview-sales-chart">${salesChart(d.chartSales || d.sales)}</div><div id="overview-sales-ranking">${rankingPanel(d.chartSales || d.sales)}</div>`}</div>`
      : "",
  ].join("");
}
function facet(key, label, rows) {
  return `<details class="facet-pop"><summary>${esc(state[key] === "all" ? label : rows.find((r) => String(r.value) === state[key])?.name || state[key])} ⌄</summary><div class="facet-options"><input data-facet-search="${key}" type="search" placeholder="Знайти…" aria-label="Пошук: ${label}"><button data-facet="${key}" data-value="all">Усі</button>${rows.map((r) => `<button data-facet="${key}" data-value="${esc(r.value)}" data-option-name="${esc(r.name.toLowerCase())}" class="${state[key] === String(r.value) ? "active" : ""}">${esc(r.name)}${r.count !== undefined ? `<small>${num(r.count)}</small>` : ""}</button>`).join("")}</div></details>`;
}
function filters(d) {
  if (["home", "channels"].includes(section)) return "";
  const categories =
      section === "sales"
        ? d.categoryOptions.map((x) => ({ value: x, name: x }))
        : d.categories || [],
    brands =
      section === "sales"
        ? d.brandOptions.map((x) => ({ value: x, name: x }))
        : d.brands || [];
  return `<div class="filterstrip">${section !== "sales" ? `<input id="search" type="search" placeholder="Назва, бренд або код товару…" aria-label="Пошук товарів" value="${esc(state.search)}"><button id="apply-search" class="search-submit">Знайти</button>` : ""}${categories.length ? facet("category", "Категорія", categories) : ""}${brands.length ? facet("brand", "Бренд", brands) : ""}${
    section === "prices"
      ? facet(
          "competitor",
          "Конкуренти",
          (d.competitors || []).map((c) => ({ value: c.id, name: c.name })),
        )
      : ""
  }<button id="clear-filters" class="reset">Скинути фільтри</button></div>`;
}
function bindFilters() {
  if ($("#apply-search"))
    $("#apply-search").onclick = () => {
      state.search = $("#search").value;
      state.page = 1;
      saveLocation();
      load();
    };
  if ($("#search"))
    $("#search").onkeydown = (e) => {
      if (e.key === "Enter") $("#apply-search").click();
    };
  $$("[data-facet]").forEach(
    (b) =>
      (b.onclick = () => {
        state[b.dataset.facet] = b.dataset.value;
        state.page = 1;
        saveLocation();
        load();
      }),
  );
  $$("[data-facet-search]").forEach(
    (input) =>
      (input.oninput = () => {
        input
          .closest(".facet-options")
          .querySelectorAll("[data-option-name]")
          .forEach(
            (b) =>
              (b.hidden = !b.dataset.optionName.includes(
                input.value.toLowerCase(),
              )),
          );
      }),
  );
  if ($("#clear-filters"))
    $("#clear-filters").onclick = () => {
      state.category = state.brand = state.competitor = "all";
      state.search = "";
      state.page = 1;
      saveLocation();
      load();
    };
}
function productCell(p, i) {
  return `<button class="celllink long-name" data-row="${i}">${esc(p.name)}</button><small class="muted" style="display:block;font-size:9px;margin-top:4px">${esc(p.brand)} · ${esc(p.code || p.id)}</small>`;
}
function table(title, cols, rows, total = rows.length, pages = 1) {
  tableRows = rows;
  return `<section class="tablepanel"><div class="tablehead"><div><h2>${title} <span class="pill">${num(total)}</span></h2><p>Натисніть назву, щоб відкрити деталі. Показано ${rows.length} рядків.</p></div><button id="export-csv" class="secondary">CSV поточної сторінки ↗</button></div><div class="tablewrap"><table><thead><tr>${cols.map((c) => `<th class="${c.numeric ? "num" : ""}">${c.name}</th>`).join("")}</tr></thead><tbody>${rows.map((r, i) => `<tr>${cols.map((c) => `<td class="${c.numeric ? "num" : ""}">${c.render ? c.render(r, i) : esc(r[c.key])}</td>`).join("")}</tr>`).join("")}</tbody></table>${!rows.length ? '<div class="empty">За вибраними умовами даних немає.</div>' : ""}</div>${pages > 1 ? `<div class="pagination"><span>Сторінка ${state.page} / ${pages}</span><div class="actions"><button id="page-prev" ${state.page <= 1 ? "disabled" : ""}>← Назад</button><button id="page-next" ${state.page >= pages ? "disabled" : ""}>Далі →</button></div></div>` : ""}</section>`;
}
function productsView(d) {
  return (
    kpis([
      kpi("У вибірці", d.total, "Усі результати фільтрів", "products/overview"),
      kpi("Без фото", d.stats.noImages, "За даними джерела", "products/photos"),
      kpi(
        "Без характеристик",
        d.stats.noAttributes,
        "За даними джерела",
        "products/attributes",
      ),
      kpi("Без відгуків", d.stats.noReviews, "За даними джерела"),
    ]) +
    table(
      "Каталог товарів",
      [
        { name: "Товар", render: productCell },
        { name: "Категорія", key: "category" },
        { name: "Ціна", numeric: true, render: (p) => money(p.price) },
        { name: "Залишок", numeric: true, render: (p) => num(p.stock) },
        { name: "Статус", key: "status" },
        { name: "Фото", numeric: true, render: (p) => num(p.images) },
        { name: "Атрибути", numeric: true, render: (p) => num(p.attributes) },
        {
          name: "Не заповнено",
          numeric: true,
          render: (p) => num(p.missingAttributes),
        },
      ],
      d.items,
      d.total,
      d.pages,
    ) +
    sourceNote(d, "Agromat API · каталог")
  );
}
function pricesView(d) {
  const count = (k) => {
    let v = d.overview?.[k];
    return v ? Number(v.tile || 0) + Number(v.sanitary || 0) : null;
  };
  return (
    kpis([
      kpi(
        "У поточному фіді",
        count("feed"),
        "Плитка та сантехніка · весь фід",
        "prices/overview",
      ),
      kpi("Зі співпадінням", count("matched"), "Усі результати моніторингу"),
      kpi(
        "Наша ціна нижча",
        count("agromatLower"),
        "За визначенням чинного джерела",
      ),
      kpi(
        "Наша ціна вища",
        count("agromatHigher"),
        "За визначенням чинного джерела",
        "prices/not-median",
      ),
    ]) +
    table(
      "Матриця цін конкурентів",
      [
        { name: "Товар", render: productCell },
        {
          name: "АГРОМАТ",
          numeric: true,
          render: (p) => `<b>${money(p.price)}</b>`,
        },
        ...(d.competitors || [])
          .filter(
            (c) =>
              state.competitor === "all" || String(c.id) === state.competitor,
          )
          .map((c) => ({
            name: c.name,
            numeric: true,
            render: (p) => money(p.competitors[c.id]?.price),
          })),
        {
          name: "Δ до медіани",
          numeric: true,
          render: (p) => {
            let a = Object.entries(p.competitors)
                .filter(
                  ([id]) =>
                    state.competitor === "all" || id === state.competitor,
                )
                .map(([, v]) => v.price)
                .filter((v) => v !== null)
                .sort((a, b) => a - b),
              m = a.length
                ? (a[Math.floor((a.length - 1) / 2)] +
                    a[Math.ceil((a.length - 1) / 2)]) /
                  2
                : null,
              diff = m && p.price !== null ? (p.price / m - 1) * 100 : null;
            return `<span class="${diff > 3 ? "bad" : diff < -3 ? "good" : ""}">${pct(diff)}</span>`;
          },
        },
        { name: "Статус", key: "status" },
      ],
      d.items,
      d.total,
      d.pages,
    ) +
    sourceNote(
      d,
      "Моніторинг конкурентів · поточний знімок. Верхні KPI — весь фід, таблиця — вибрані умови.",
    )
  );
}
function promotionsView(d) {
  let body;
  if (view === "programs") {
    const programs = d.programs.map((p) => ({
      ...p,
      name: p.name,
      id: p.idinc,
    }));
    body = table(
      "Програми акцій",
      [
        {
          name: "Програма",
          render: (p, i) =>
            `<button class="celllink long-name" data-row="${i}">${esc(p.name)}</button>`,
        },
        { name: "Тип", key: "type" },
        { name: "Початок", key: "startDate" },
        { name: "Завершення", key: "endDate" },
        { name: "Товарів", numeric: true, render: (p) => num(p.productCount) },
        {
          name: "Статус",
          render: (p) =>
            p.active
              ? '<span class="pill good">Активна</span>'
              : '<span class="pill">Неактивна</span>',
        },
      ],
      programs,
    );
  } else
    body = table(
      "Акційні товари",
      [
        { name: "Товар", render: productCell },
        { name: "Програма", key: "program" },
        {
          name: "Базова ціна",
          numeric: true,
          render: (p) => money(p.basePrice),
        },
        {
          name: "Акційна ціна",
          numeric: true,
          render: (p) => `<b class="blue">${money(p.price)}</b>`,
        },
        { name: "Знижка", numeric: true, render: (p) => pct(p.discount) },
        { name: "Залишок", numeric: true, render: (p) => num(p.stock) },
        { name: "Фото", numeric: true, render: (p) => num(p.images) },
      ],
      d.items,
      d.total,
      d.pages,
    );
  return (
    kpis([
      kpi(
        "Акційних товарів",
        d.stats.products,
        "За вибраними умовами",
        "promotions/overview",
      ),
      kpi(
        "Програм",
        d.stats.promotions,
        "У відповіді джерела",
        "promotions/programs",
      ),
      kpi("Без фото", d.stats.noPhoto, "Акційні товари", "promotions/photos"),
      kpi(
        "Без атрибутів",
        d.stats.missingAttributes,
        "Обов’язкові характеристики",
        "promotions/attributes",
      ),
    ]) +
    body +
    sourceNote(d, "Agromat API · акційний каталог")
  );
}
function salesView(d) {
  const m = d.metrics,
    p =
      state.yoy && d.previous?.available && d.previous.hasData
        ? d.previous.metrics
        : null;
  let cards = kpis([
    kpi(
      "Відвантажений виторг",
      money(m.shippedRevenue),
      "Завершені відвантаження",
      "",
      null,
    ),
    kpi("Документів", m.totalDocs, "Усі статуси", "", p?.totalDocs),
    kpi(
      "Відвантажено",
      m.shippedDocs,
      "Кількість документів",
      "",
      p?.shippedDocs,
    ),
    kpi(
      "Скасовано",
      m.canceledDocs,
      "Кількість документів",
      "sales/cancellations",
    ),
  ]);
  if (p && m.shippedRevenue !== null && p.shippedRevenue > 0)
    cards = cards.replace(
      "Завершені відвантаження</small>",
      `Завершені відвантаження</small><span class="stat-yoy ${m.shippedRevenue >= p.shippedRevenue ? "good" : "bad"}">${pct((m.shippedRevenue / p.shippedRevenue - 1) * 100)} YoY · ${money(p.shippedRevenue)} торік</span>`,
    );
  let body = "";
  if (view === "overview") {
    body = `<div class="grid">${salesChart(d)}${panel("Виконання плану", d.plan.month || "План джерела", `<div class="plan-big">${pct(d.plan.completionPct)}</div><p>План ${money(d.plan.plan)} · факт ${money(d.plan.revenue)}</p><p>Плановий зріз джерела може відрізнятися від довільного календарного періоду.</p>`)}</div><div class="grid equal">${panel("Категорії", "Відвантажений виторг", bars(d.categories, "revenue", "category"))}${panel("Бренди", "Відвантажений виторг", bars(d.brands, "revenue", "brand"))}</div>`;
  } else if (view === "categories" || view === "brands") {
    let rows = view === "categories" ? d.categories : d.brands;
    body = table(
      view === "categories" ? "Продажі за категоріями" : "Продажі за брендами",
      [
        {
          name: "Назва",
          render: (r) =>
            `<button class="celllink" data-dimension="${view === "categories" ? "category" : "brand"}" data-value="${esc(r.label)}">${esc(r.label)}</button>`,
        },
        { name: "Документів", numeric: true, render: (r) => num(r.docs) },
        { name: "Одиниць", numeric: true, render: (r) => num(r.goods) },
        { name: "Виторг", numeric: true, render: (r) => money(r.revenue) },
      ],
      rows,
    );
  } else {
    let rows = view === "states" ? d.states : d.cancelReasons;
    body = table(
      view === "states" ? "Статуси документів" : "Причини скасувань",
      [
        { name: "Статус / причина", render: (r) => esc(r.state || r.reason) },
        { name: "Документів", numeric: true, render: (r) => num(r.docs) },
        {
          name: "Сума документів",
          numeric: true,
          render: (r) => money(r.revenue),
        },
      ],
      rows,
    );
  }
  return (
    cards +
    body +
    sourceNote(
      d,
      "Джерело продажів · суми у гривнях. Клієнтські дані не передаються у Studio.",
    )
  );
}
function channelsView(d) {
  const total = d.rows.reduce(
      (s, r) => ({
        sessions: s.sessions + r.sessions,
        purchases: s.purchases + r.purchases,
        revenue: s.revenue + r.revenue,
      }),
      { sessions: 0, purchases: 0, revenue: 0 },
    ),
    prior = d.previous?.available
      ? d.previous.rows.reduce(
          (s, r) => ({
            sessions: s.sessions + r.sessions,
            purchases: s.purchases + r.purchases,
            revenue: s.revenue + r.revenue,
          }),
          { sessions: 0, purchases: 0, revenue: 0 },
        )
      : null;
  return (
    warning(d.notice) +
    (d.thresholded
      ? warning(
          "GA4 застосував пороги конфіденційності; частина даних може бути прихована.",
        )
      : "") +
    kpis([
      kpi("Сесії", total.sessions, "GA4", "", prior?.sessions),
      kpi(
        "Покупки",
        total.purchases,
        "Події ecommercePurchases",
        "",
        prior?.purchases,
      ),
      kpi("Атрибутована виручка", money(total.revenue), "GA4 purchaseRevenue"),
      kpi(
        "CR сесія → покупка",
        pct(total.sessions ? (total.purchases / total.sessions) * 100 : null),
        "GA4 · той самий період",
      ),
    ]) +
    table(
      "Канали залучення · GA4",
      [
        { name: "Канал", key: "channel" },
        { name: "Сесії", numeric: true, render: (r) => num(r.sessions) },
        { name: "Покупки", numeric: true, render: (r) => num(r.purchases) },
        {
          name: "CR",
          numeric: true,
          render: (r) =>
            pct(r.sessions ? (r.purchases / r.sessions) * 100 : null),
        },
        {
          name: "Атрибутована виручка",
          numeric: true,
          render: (r) => money(r.revenue),
        },
        {
          name: "Рік до року · виручка",
          numeric: true,
          render: (r) => {
            let p = d.previous?.rows?.find((p) => p.channel === r.channel);
            return state.yoy && p?.revenue > 0
              ? pct((r.revenue / p.revenue - 1) * 100)
              : "—";
          },
        },
        {
          name: "Витрати / ROAS / ROMI",
          render: () =>
            '<span class="muted">Джерело витрат не підключено</span>',
        },
      ],
      d.rows,
    ) +
    sourceNote(
      d,
      "GA4 · дані каналу не фільтруються за SKU, оскільки це джерело повертає агрегати за джерелами залучення.",
    )
  );
}
function sourceNote(d, name) {
  return `<p class="source-foot">${esc(name)} · Оновлено у джерелі: ${timestamp(d.updatedAt)} · Отримано Studio: ${timestamp(d.loadedAt)}</p>`;
}
function bindContent() {
  bindOverviewControls();
  bindBusinessOverview();
  $$("[data-action]").forEach(
    (b) => (b.onclick = () => go(...b.dataset.action.split("/"))),
  );
  $$("[data-metric]").forEach(
    (b) =>
      (b.onclick = () =>
        modal(
          b.dataset.metric,
          "<p>Показник отримано з чинного джерела даних. Значення не підміняються демонстраційними. Дата оновлення наведена під таблицею.</p>",
        )),
  );
  $$("[data-dimension]").forEach(
    (b) =>
      (b.onclick = () => {
        let kind = b.dataset.dimension;
        go("sales", kind === "brand" ? "brands" : "categories", {
          [kind]: b.dataset.value,
        });
      }),
  );
  $$("[data-bucket]").forEach(
    (b) =>
      (b.onclick = () =>
        modal(
          b.dataset.bucket,
          "<p>Агрегований показник джерела продажів для вибраного періоду.</p>",
        )),
  );
  $$("[data-row]").forEach(
    (b) => (b.onclick = () => openRow(tableRows[Number(b.dataset.row)])),
  );
  if ($("#page-prev"))
    $("#page-prev").onclick = () => {
      state.page--;
      saveLocation();
      load();
    };
  if ($("#page-next"))
    $("#page-next").onclick = () => {
      state.page++;
      saveLocation();
      load();
    };
  if ($("#export-csv")) $("#export-csv").onclick = exportCsv;
}
function modal(title, body) {
  $("#detail-body").innerHTML =
    `<header class="dialoghead"><div><div class="eyebrow">AGROMAT / ДЕТАЛІ</div><h2 id="detail-title">${esc(title)}</h2></div><button class="close" aria-label="Закрити">×</button></header><div class="dialogbody">${body}</div>`;
  if (!$("#detail").open) $("#detail").showModal();
  $(".close").onclick = () => $("#detail").close();
}
function openRow(r) {
  const rows = [
    ["Код", r.code || r.id],
    ["Бренд", r.brand],
    ["Категорія", r.category],
    ["Ціна", money(r.price)],
    ["Базова ціна", r.basePrice !== undefined ? money(r.basePrice) : null],
    ["Залишок", r.stock],
    ["Статус", r.status],
    ["Фото", r.images],
    ["Атрибути", r.attributes],
    ["Не заповнено обов’язкових", r.missingAttributes],
    ["Програма", r.program || r.name],
    ["Початок програми", r.startDate || r.from],
    ["Завершення програми", r.endDate || r.to],
    ["Товарів програми", r.productCount],
  ].filter(([, v]) => v !== null && v !== undefined && v !== "");
  let rivals = r.competitors
    ? Object.entries(r.competitors)
        .map(
          ([id, c]) =>
            `<div class="listline"><span>${esc(data.competitors.find((x) => String(x.id) === id)?.name || id)}</span><b>${money(c.price)}</b></div>`,
        )
        .join("")
    : "";
  modal(
    r.name,
    `<div class="record-detail"><dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl></div>${rivals ? `<h3 style="margin-top:25px">Ціни конкурентів</h3>${rivals}` : ""}${r.url ? `<a class="external-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Відкрити товар на сайті ↗</a>` : ""}<p class="source-note">Деталі поточної відповіді джерела. Повернення до вибірки зберігає ваші фільтри.</p>`,
  );
}
function exportCsv() {
  let rows = tableRows.map((r) =>
      Object.fromEntries(
        Object.entries(r).filter(
          ([, v]) => v === null || typeof v !== "object",
        ),
      ),
    ),
    keys = [...new Set(rows.flatMap((r) => Object.keys(r)))],
    q = (v) => '"' + String(v ?? "").replaceAll('"', '""') + '"',
    csv =
      "\uFEFF" +
      keys.map(q).join(";") +
      "\r\n" +
      rows.map((r) => keys.map((k) => q(r[k])).join(";")).join("\r\n"),
    url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = "agromat-studio-" + section + "-page-" + state.page + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
$("#detail").onclick = (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
};
document.addEventListener("click", (e) => {
  if (!e.target.isConnected) return;
  $$("details[open]:not(.bo-quantity-group)").forEach((d) => {
    if (!d.contains(e.target)) d.open = false;
  });
});
parseLocation();
load();
