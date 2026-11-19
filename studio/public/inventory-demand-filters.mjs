import {addDays,rangeDays} from './overview-filters.mjs';

export const inventoryPageSize = 50;
export const inventoryPrioritySize = 10;
export const inventoryStatuses = {in:'Доступний для замовлення', out:'Недоступний для замовлення', unknown:'Невідомо'};
export const inventoryDemand = {high:'Високий', low:'Низький', unknown:'Невідомо'};
export const inventoryConfidence = {high:'Висока', medium:'Середня', low:'Низька'};
export const inventoryPrice = {low:'До 1 000 грн', middle:'1 000–4 999,99 грн', high:'Від 5 000 грн', unknown:'Ціна невідома'};
export const inventoryMatrix = {stable:'Стабільні продажі', priority:'Пріоритет поповнення', excess:'Надлишковий асортимент', low:'Низький пріоритет'};
export const inventoryColumns = {
  code:'Код SKU', name:'Назва товару', category:'Категорія', brand:'Бренд', status:'Доступність на кінець періоду',
  lastLoss:'Дата останньої втрати доступності', outDays:'Днів недоступності', dailyRevenue:'Середньоденні продажі, грн',
  dailyUnits:'Середньоденні відвантаження, од.', loss:'Потенційно втрачений оборот, грн',
  margin:'Потенційно втрачена маржа, грн', confidence:'Достовірність прогнозу',
};
export const inventoryWatchColumns = {code:'Код SKU',name:'Назва товару',revenue:'Виторг з початку року',
  views:'Перегляди за 7 днів',stock:'Залишок',watchStatus:'Сигнал',status:inventoryColumns.status,loss:inventoryColumns.loss};
export const inventoryWatchStatuses = {low:'Низький залишок',ok:'Достатній залишок',unknown:'Невідомо'};

export function inventoryDefaults(today) {
  return {from:addDays(today,-30),to:addDays(today,-1)};
}

export function inventoryPrevious(range) {
  return {from:addDays(range.from,-rangeDays(range)),to:addDays(range.from,-1)};
}

export function inventorySelection(input, today = new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Kyiv'})) {
  const params = new URLSearchParams(input);
  const options = {
    status:['all',...Object.keys(inventoryStatuses)], demand:['all',...Object.keys(inventoryDemand)],
    price:['all',...Object.keys(inventoryPrice)], promo:['all','yes','no','unknown'],
    quadrant:['all',...Object.keys(inventoryMatrix)], sort:Object.keys(inventoryColumns),
    direction:['desc','asc'], view:['all','alerts','watch'], export:['0','1'],
  };
  const textFields = ['category','subcategory','brand','search','sku'];
  const integers = {minDays:[0,90],maxDays:[90,90],page:[1,10000]};
  const keys = new Set(['from','to','priorityDate',...textFields,...Object.keys(options),...Object.keys(integers)]);
  for (const key of params.keys()) {
    if (!keys.has(key) || params.getAll(key).length !== 1) throw Error('invalid_inventory_filter');
  }
  const result = {...inventoryDefaults(today), ...Object.fromEntries(params)};
  for (const value of [result.from,result.to]) {
    if (!/^\d{4}-\d\d-\d\d$/.test(value) || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0,10) !== value || value < '2020-01-01' || value >= today) throw Error('invalid_inventory_range');
  }
  if (rangeDays(result) < 1 || rangeDays(result) > 90) throw Error('invalid_inventory_range');
  if (params.has('priorityDate')) {
    const date = result.priorityDate;
    if (!/^\d{4}-\d\d-\d\d$/.test(date) || date<result.from || date>result.to ||
        !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date) {
      throw Error('invalid_inventory_priority_date');
    }
  }
  const defaults = {sort:'loss', direction:'desc', view:'all', export:'0'};
  for (const [key,allowed] of Object.entries(options)) {
    result[key] ??= defaults[key] ?? 'all';
    if (!allowed.includes(result[key])) throw Error('invalid_inventory_filter');
  }
  for (const key of textFields) {
    result[key] = (result[key] ?? '').trim();
    if (result[key].length > 160 || /[\u0000-\u001f]/.test(result[key])) throw Error('invalid_inventory_filter');
  }
  for (const [key,[fallback,max]] of Object.entries(integers)) {
    result[key] ??= String(fallback);
    if (!/^\d+$/.test(result[key]) || Number(result[key]) > max || (key === 'page' && Number(result[key]) < 1)) {
      throw Error('invalid_inventory_filter');
    }
    result[key] = String(Number(result[key]));
  }
  if (Number(result.minDays) > Number(result.maxDays) || (result.sku && result.export === '1')) throw Error('invalid_inventory_filter');
  if (result.priorityDate && (result.sku || result.export==='1')) throw Error('invalid_inventory_filter');
  return result;
}

export const qualityLabels = {
  history:'Недостатньо днів доступності або продажів', gaps:'Прогалини в історії статусів або ERP',
  irregular:'Нерегулярні продажі або сильні коливання', concentration:'Продажі сконцентровані в одному тижні',
  promo:'Акції суттєво змінюють середній оборот', promoUnknown:'Історія акцій неповна',
  price:'Ціна змінювалася більш ніж на 20%', margin:'Неповне покриття собівартості SKU',
  validation:'Бракує даних для історичної перевірки', error:'Похибка історичної перевірки понад 50%',
};
