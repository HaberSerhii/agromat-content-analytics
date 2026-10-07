"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiCart } from "@/lib/cart-types";
const s = {"funnel": "checkout-funnel", "abandoned": "checkout-abandoned", "active": "checkout-active", "availability": "checkout-availability", "bottom": "checkout-bottom", "cartLink": "checkout-cartLink", "charts": "checkout-charts", "checkbox": "checkout-checkbox", "clickableRow": "checkout-clickableRow", "close": "checkout-close", "contactKpi": "checkout-contactKpi", "context": "checkout-context", "converted": "checkout-converted", "demo": "checkout-demo", "detail": "checkout-detail", "detailGrid": "checkout-detailGrid", "dot": "checkout-dot", "drawer": "checkout-drawer", "empty": "checkout-empty", "eyebrow": "checkout-eyebrow", "filters": "checkout-filters", "funnelLabel": "checkout-funnelLabel", "funnelRow": "checkout-funnelRow", "heading": "checkout-heading", "insight": "checkout-insight", "kpis": "checkout-kpis", "loss": "checkout-loss", "lossMoney": "checkout-lossMoney", "lossSelected": "checkout-lossSelected", "lossTrack": "checkout-lossTrack", "losses": "checkout-losses", "note": "checkout-note", "open": "checkout-open", "overlay": "checkout-overlay", "pagination": "checkout-pagination", "panel": "checkout-panel", "panelHead": "checkout-panelHead", "percent": "checkout-percent", "period": "checkout-period", "productRow": "checkout-productRow", "rank": "checkout-rank", "right": "checkout-right", "root": "checkout-root", "stageBadge": "checkout-stageBadge", "stageHelp": "checkout-stageHelp", "stageSwitch": "checkout-stageSwitch", "status": "checkout-status", "statusSummary": "checkout-statusSummary", "step": "checkout-step", "tableWrap": "checkout-tableWrap", "tag": "checkout-tag", "track": "checkout-track"};

type Status = "abandoned" | "active" | "converted";
type Cart = { id: number; status: Status; stage: number; day: number; hours: number; total: number; contact: boolean; name: string; product: string; sku: string; qty: number; delivery: string; payment: string; promo_code: string | null; promo_discount: number; raw?: ApiCart };
const stages = ["Кошик", "Контакти", "Доставка", "Оплата", "Замовлення"];
const labels = { abandoned: "Покинутий", active: "Активний", converted: "Замовлення" };
const products = ["Плитка Opoczno Calacatta 60×60", "Змішувач Grohe Eurosmart", "Унітаз Roca The Gap", "Ванна Ravak Classic 170", "Плитка Paradyz Classica 30×60", "Душова система Hansgrohe Crometta"];
const names = ["Олена · демо", "Андрій · демо", "Марія · демо", "Дмитро · демо", "Ірина · демо"];
const carts: Cart[] = Array.from({ length: 210 }, (_, i) => {
  const bucket = (i * 37) % 100;
  const status: Status = bucket < 57 ? "abandoned" : bucket < 75 ? "active" : "converted";
  return { id: 10420 + i, status, stage: status === "converted" ? 4 : (i * 7 % 10 < 4 ? 0 : 1 + i % 3), day: i % 7, hours: status === "active" ? (i % 6 + 1) / 10 : 3 + i % (11 + (i % 7) * 24), total: 450 + (i * 1297 % 34000), contact: i % 5 < 3, name: names[i % names.length], product: products[i % products.length], sku: `DEMO-${1000 + i % products.length}`, qty: 1 + i % 4, delivery: ["Самовивіз AGROMAT", "Нова пошта", "Доставка AGROMAT"][i % 3], payment: ["Карткою онлайн", "При отриманні", "За рахунком"][i % 3], promo_code: i % 4 === 0 ? ["DEMO-WELCOME", "DEMO-AUTUMN", "DEMO-AGROMAT"][(i / 4) % 3] : null, promo_discount: i % 4 === 0 ? 100 + (i * 17 % 1500) : 0 };
});
const checkoutLabels: Record<string, string> = {
  "user-name": "Ім’я", "user-phone": "Телефон", "user-email": "Email", "recipient-name": "Ім’я отримувача", "recipient-phone": "Телефон отримувача",
  "delivery-type": "Спосіб доставки", "payment-type": "Спосіб оплати", payment_systems_id: "Платіжна система", saved_address_id: "Збережена адреса",
  "floor-checkbox": "Доставка на поверх", elevator: "Ліфт", date: "Дата доставки", comment: "Коментар",
  "stock": "ID складу", "delivery-city_agromat-stock": "Склад самовивозу", "delivery-city_np-city-name": "Місто Нової пошти", "delivery-city_np-city": "Код міста Нової пошти",
  "delivery-city_np-department-name": "Відділення Нової пошти", "delivery-city_np-department": "Код відділення Нової пошти",
  "delivery-city_np-postomat-city-name": "Місто поштомата", "delivery-city_np-postomat-city": "Код міста поштомата",
  "delivery-city_np-courier-name": "Місто кур’єрської доставки", "delivery-city_np-courier": "Код міста кур’єрської доставки",
  "delivery-city_agromat-kyiv_city": "Місто доставки AGROMAT", "delivery-city_agromat-kyiv_street": "Вулиця доставки AGROMAT",
};
const deliveryLabels: Record<string, string> = { npDepartment: "Нова пошта · відділення", npCourier: "Нова пошта · кур’єр", agrWarehouse: "Самовивіз AGROMAT", agrCity: "Доставка AGROMAT · місто", agrUkraine: "Доставка AGROMAT · Україна" };
const paymentLabels: Record<string, string> = {cash: "Готівка", bank: "Безготівкова оплата", online: "Онлайн-оплата", online_full: "Онлайн · повна оплата", online_parts: "Оплата частинами"};
const fieldValue = (key: string, value: string | number | boolean, cart?: ApiCart) => key === "payment-type" ? paymentLabels[String(value)] || String(value) : key === "delivery-city_agromat-stock" ? cart?.delivery_point?.name ? `${cart.delivery_point.name} · код форми ${value}` : `Код складу у формі: ${value} · назва не передана API` : key === "delivery-type" ? deliveryLabels[String(value)] || String(value) : typeof value === "boolean" ? value ? "Так" : "Ні" : String(value);
const dateTime = (value: string) => new Date(value).toLocaleString("uk-UA", {timeZone: "Europe/Kyiv", dateStyle: "medium", timeStyle: "medium"});
const stageName = (stage: string, step: number | null) => stage === "checkout" ? `Checkout · ${stages[step || 1] || `крок ${step}`}` : stage === "cart" ? "Кошик" : stage;
const money = (n: number) => new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 }).format(n) + " ₴";
const pct = (n: number, d: number) => d ? Math.round(n / d * 100) + "%" : "—";

export default function AbandonedCartsDemo({ apiCarts }: { apiCarts?: ApiCart[] } = {}) {
  const live = apiCarts !== undefined;
  const liveCarts = useMemo(() => apiCarts?.map(raw => ({
    id: raw.id, status: raw.status, stage: raw.status === "converted" ? 4 : raw.furthest_stage === "checkout" ? Math.max(1, Math.min(3, raw.furthest_checkout_step || 1)) : 0,
    day: 0, hours: Math.max(0, (Date.now() - Date.parse(raw.updated_at)) / 3600000), total: raw.total,
    contact: Boolean(raw.customer?.phone?.trim() || String(raw.checkout_fields?.["user-phone"] || "").trim()),
    name: raw.customer?.name || String(raw.checkout_fields?.["user-name"] || "Клієнт без імені"),
    product: raw.items.map(item => item.name).join(", "), sku: raw.items.map(item => item.sku).join(", "), qty: raw.items.reduce((n, item) => n + item.qty, 0),
    delivery: String(raw.checkout_fields?.["delivery-type"] || "Не введено"), payment: String(raw.checkout_fields?.["payment-type"] || "Не введено"),
    promo_code: raw.promo_code, promo_discount: raw.promo_discount, raw,
  } satisfies Cart)), [apiCarts]);
  const [period, setPeriod] = useState("7");
  const [status, setStatus] = useState(live ? "all" : "abandoned");
  const [stage, setStage] = useState("all");
  const [contacts, setContacts] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Cart | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
      if (event.key !== "Tab") return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex="0"]');
      if (!nodes?.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", handleKey); previous?.focus(); };
  }, [selected]);
  const [sort, setSort] = useState("total");
  const [page, setPage] = useState(1);
  const cohort = useMemo(() => liveCarts ?? carts.filter(c => c.day < Number(period)), [period, liveCarts]);
  const abandoned = cohort.filter(c => c.status === "abandoned");
  const amount = abandoned.reduce((n, c) => n + c.total, 0);
  const contactable = abandoned.filter(c => c.contact);
  const checkout = abandoned.filter(c => c.stage > 0);
  const rows = cohort.filter(c => (status === "all" || c.status === status) && (stage === "all" || c.stage === Number(stage)) && (!contacts || c.contact) && `${c.id} ${c.product} ${c.sku} ${c.promo_code ?? ""} ${c.name}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === "total" ? b.total - a.total : b.hours - a.hours);
  const pageCount = Math.max(1, Math.ceil(rows.length / 8));
  const currentPage = Math.min(page, pageCount);
  const reached = stages.map((_, i) => cohort.filter(c => c.stage >= i).length);
  const losses = stages.slice(0, 4).map((label, i) => ({ label, count: abandoned.filter(c => c.stage === i).length, sum: abandoned.filter(c => c.stage === i).reduce((n, c) => n + c.total, 0) }));
  const largestLoss = losses.reduce((a, b) => a.sum > b.sum ? a : b);
  const demoRanking = products.map(product => ({ product, count: abandoned.filter(c => c.product === product).length, total: abandoned.filter(c => c.product === product).reduce((n, c) => n + c.total, 0) })).sort((a, b) => b.total - a.total);
  const itemGroups = new Map<string, { product: string; count: number; total: number }>();
  for (const c of abandoned) {
    const seen = new Set<string>();
    for (const item of c.raw?.items || []) {
      const key = `${item.type}:${item.id}`;
      const group = itemGroups.get(key) || { product: item.name, count: 0, total: 0 };
      group.total += item.sum;
      if (!seen.has(key)) group.count++;
      seen.add(key); itemGroups.set(key, group);
    }
  }
  const ranking = live ? [...itemGroups.values()].sort((a, b) => b.total - a.total) : demoRanking;
  const resetPage = () => setPage(1);
  return <div className={s.root}>
    <div className={s.demo}><span className={s.dot} /> {live ? "Carts API · поточні статуси кошиків" : "ДЕМО · Вигадані дані для оцінки дизайну"} <span>{live ? "Період за датою створення · час Києва" : "Поріг покинутої корзини: 2 години · час Києва"}</span></div>
    <header className={s.heading}><div><div className={s.eyebrow}>АНАЛІТИКА ІНТЕРНЕТ-МАГАЗИНУ / CHECKOUT</div>{!live && <h1>Покинуті кошики<span> та оформлення</span></h1>}<p>Де зупиняються клієнти та які кошики потребують уваги.</p></div>{!live && <label className={s.period}>Дата створення кошика<select aria-label="Період" value={period} onChange={e => { setPeriod(e.target.value); resetPage(); }}><option value="7">1–7 жовтня 2026</option><option value="3">5–7 жовтня 2026</option><option value="1">7 жовтня 2026</option></select></label>}</header>
    {live && <>
      <div className={s.statusSummary} role="group" aria-label="Статуси кошиків">{([
        ["all", "Усі кошики"], ["active", "Активні"], ["abandoned", "Покинуті"], ["converted", "Створили замовлення"],
      ] as const).map(([value, label]) => <button key={value} aria-pressed={status === value} onClick={() => { setStatus(value); setStage("all"); setSearch(""); setContacts(false); resetPage(); }}><span>{label}</span><strong>{value === "all" ? cohort.length : cohort.filter(c => c.status === value).length}</strong></button>)}</div>
      {cohort.length > 0 && abandoned.length === 0 && <div className={s.availability}>Дані завантажено: {cohort.length} кошиків. API ще не позначив жоден як покинутий. Нижче показники покинутих кошиків дорівнюють нулю; у таблиці доступні активні кошики та замовлення.</div>}
      <div className={s.eyebrow} style={{marginBottom: 12}}>ПОКАЗНИКИ ЛИШЕ ПОКИНУТИХ КОШИКІВ</div>
    </>}
    <div className={s.kpis}>
      <article><span>Покинуті кошики</span><strong>{abandoned.length}</strong><small>{pct(abandoned.length, cohort.length)} від {cohort.length} кошиків у вибірці</small></article>
      <article><span>Вартість покинутих кошиків</span><strong>{money(amount)}</strong><small>Товари після знижок, без доставки</small></article>
      <article><span>Покинутий checkout</span><strong>{checkout.length}<em> / {pct(checkout.length, abandoned.length)}</em></strong><small>Почали оформлення, не створили замовлення</small></article>
      <article className={s.contactKpi}><span>Є контакт для менеджера</span><strong>{contactable.length}<em> / {pct(contactable.length, abandoned.length)}</em></strong><small>Кошики на {money(contactable.reduce((n, c) => n + c.total, 0))}</small></article>
    </div>
    <div className={s.charts}>
      <section className={s.panel}><div className={s.panelHead}><div><h2>Воронка оформлення</h2><p>Найвіддаленіша досягнута точка · всі статуси</p></div><span className={s.tag}>{cohort.length} кошиків</span></div>
        <div className={s.funnel}>{stages.map((label, i) => <div className={s.funnelRow} key={label}><span className={s.step}>{i + 1}</span><div className={s.funnelLabel}>{label}<small>{i === 0 ? "Додали товар" : i === 4 ? "Є order_id" : `Крок checkout ${i}`}</small></div><div className={s.track}><div style={{ width: `${reached[0] ? reached[i] / reached[0] * 100 : 0}%`, background: i === 4 ? "#219d84" : `hsl(209 95% ${48 + i * 6}%)` }} /></div><strong>{reached[i]}</strong><span className={s.percent}>{pct(reached[i], reached[0])}</span></div>)}</div>
        <div className={s.note}>Досягнення кроку не означає, що всі поля заповнені. Замовлення може ще не бути оплаченим.</div>
      </section>
      <section className={s.panel}><div className={s.panelHead}><div><h2>Де залишають кошик</h2><p>Лише покинуті · натисніть етап для фільтрації</p></div><span className={s.tag}>Кількість / сума</span></div>
        <div className={s.losses}>{losses.map((l, i) => <button key={l.label} className={`${s.loss} ${stage === String(i) ? s.lossSelected : ""}`} onClick={() => { setStage(stage === String(i) ? "all" : String(i)); setStatus("abandoned"); resetPage(); }}><div><span>{l.label}</span><strong>{l.count}<small>{pct(l.count, abandoned.length)}</small></strong></div><div className={s.lossTrack}><div style={{ width: `${abandoned.length ? l.count / abandoned.length * 100 : 0}%` }} /></div><span className={s.lossMoney}>{money(l.sum)}</span></button>)}</div>
        {abandoned.length > 0 ? <div className={s.insight}><span>↗</span><div>Найбільша сума на етапі «{largestLoss.label}»<small>{money(largestLoss.sum)} · сегмент для детальнішого аналізу</small></div></div> : <div className={s.note}>У цьому періоді покинутих кошиків немає.</div>}
      </section>
    </div>
    <section className={s.panel}>
      <div className={s.panelHead}><div><h2>{live ? "Реєстр кошиків" : "Кошики, що потребують уваги"}</h2><p>Відкрийте рядок, щоб переглянути товари та введені поля</p></div><span className={s.tag}>{rows.length} у вибірці</span></div>
      <div className={s.stageSwitch} role="group" aria-label="Фільтр за максимально досягнутим етапом">{["Усі етапи", ...stages].map((label, i) => {
        const value = i === 0 ? "all" : String(i - 1);
        const count = cohort.filter(c => (status === "all" || c.status === status) && (!contacts || c.contact) && `${c.id} ${c.product} ${c.sku} ${c.promo_code ?? ""} ${c.name}`.toLowerCase().includes(search.toLowerCase()) && (value === "all" || c.stage === Number(value))).length;
        return <button key={value} aria-pressed={stage === value} onClick={() => { setStage(value); resetPage(); }}>{label}<span>{count}</span></button>;
      })}</div>
      <p className={s.stageHelp}>Фільтр показує кошики, для яких цей етап є найдальшим досягнутим. Інші фільтри зберігаються.</p>
      <div className={s.filters}><input aria-label="Пошук кошиків" placeholder="ID, клієнт, товар або промокод…" value={search} onChange={e => { setSearch(e.target.value); resetPage(); }} /><select aria-label="Статус" value={status} onChange={e => { setStatus(e.target.value); resetPage(); }}><option value="abandoned">Покинуті</option><option value="active">Активні</option><option value="converted">Замовлення</option><option value="all">Усі статуси</option></select><label className={s.checkbox}><input type="checkbox" checked={contacts} onChange={e => { setContacts(e.target.checked); resetPage(); }} /> Лише з контактом</label><select aria-label="Сортування" value={sort} onChange={e => { setSort(e.target.value); resetPage(); }}><option value="total">Сума ↓</option><option value="age">Час без змін ↓</option></select></div>
      <div className={s.tableWrap}><table><thead><tr><th>Кошик / клієнт</th><th>Етап</th><th>Час від останньої зміни</th><th>Статус</th><th>Промокод / знижка</th><th className={s.right}>Сума</th><th /></tr></thead><tbody>{rows.slice((currentPage - 1) * 8, currentPage * 8).map(c => <tr key={c.id} className={s.clickableRow} tabIndex={0} aria-label={`Деталі кошика ${c.id}`} onClick={() => setSelected(c)} onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setSelected(c); } }}><td data-label="Кошик / клієнт"><button className={s.cartLink} onClick={() => setSelected(c)}>#{c.id}</button><small>{c.raw ? c.raw.anonymous ? "Анонімний клієнт" : c.name : c.contact ? c.name : "Анонімний клієнт"}</small></td><td data-label="Етап"><span className={s.stageBadge}>{stages[c.stage]}</span></td><td data-label="Час від останньої зміни">{c.hours < 1 ? `${Math.round(c.hours * 60)} хв` : `${Math.floor(c.hours)} год`}<small>{c.raw ? new Date(c.raw.updated_at).toLocaleString("uk-UA", {timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short"}) : `${7 - c.day} жовтня · демо`}</small></td><td data-label="Статус"><span className={`${s.status} ${s[c.status]}`}>{labels[c.status]}</span></td><td data-label="Промокод / знижка">{c.promo_code ? <><strong>{c.promo_code}</strong><small>Знижка: {money(c.promo_discount)}</small></> : <span className={s.percent}>Без промокоду</span>}</td><td data-label="Сума" className={s.right}><strong>{money(c.total)}</strong></td><td data-label="Деталі"><button aria-label={`Відкрити кошик ${c.id}`} className={s.open} onClick={() => setSelected(c)}>↗</button></td></tr>)}</tbody></table>{!rows.length && <div className={s.empty}>За цими фільтрами кошиків немає. Змініть статус, пошук або етап.</div>}</div>
      <div className={s.pagination}><span>Показано {rows.length ? (currentPage - 1) * 8 + 1 : 0}–{Math.min(currentPage * 8, rows.length)} з {rows.length}</span><div><button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>←</button><span>{currentPage} / {pageCount}</span><button disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>→</button></div></div>
    </section>
    <div className={s.bottom}>
      <section className={s.panel}><div className={s.panelHead}><div><h2>Товари у покинутих кошиках</h2><p>{live ? "Суми товарних рядків API · промознижка кошика окремо" : "Рейтинг за вартістю · один товар у кожному демо-кошику"}</p></div></div>{ranking.slice(0, 4).map((r, i) => <div className={s.productRow} key={r.product}><span className={s.rank}>{i + 1}</span><div>{r.product}<small>{r.count} кошиків</small></div><strong>{money(r.total)}</strong></div>)}</section>
      <section className={`${s.panel} ${s.context}`}><div className={s.eyebrow}>ЯК ЧИТАТИ ЦІ ДАНІ</div><h2>Кошик — це намір придбати</h2><p>Його вартість показує потенціал, а не втрачену виручку. Клієнт може повернутись і завершити покупку.</p><div><span>Активні</span><strong>{cohort.filter(c => c.status === "active").length}</strong></div><div><span>Створили замовлення</span><strong>{cohort.filter(c => c.status === "converted").length}</strong></div><small>Вибірка показує поточні статуси. Для оцінки конверсії потрібні зрілі когорти та історія змін.</small></section>
    </div>
    {selected && <div className={s.overlay} onClick={() => setSelected(null)}><section ref={dialogRef} role="dialog" aria-modal="true" aria-label={`Кошик ${selected.id}`} className={s.drawer} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Escape") setSelected(null); }}><button autoFocus className={s.close} aria-label="Закрити" onClick={() => setSelected(null)}>×</button><div className={s.eyebrow}>{live ? "CARTS API · ДЕТАЛІ КОШИКА" : "ДЕМО · ДЕТАЛІ КОШИКА"}</div><h2>Кошик #{selected.id}</h2><span className={`${s.status} ${s[selected.status]}`}>{labels[selected.status]}</span><h3>{money(selected.total)}</h3><p>Після знижок · без доставки</p><div className="checkout-modalGrid"><div className={s.detail}><h4>Промокод та знижка</h4><p>{selected.promo_code ?? "Без промокоду"}</p><small>Знижка за промокодом: {money(selected.promo_discount)}</small><small>Сума кошика вже враховує знижку.</small></div><div className={s.detail}><h4>Клієнт</h4>{selected.raw && <dl className={s.detailGrid}><dt>Тип клієнта</dt><dd>{selected.raw.anonymous ? "Анонімний" : selected.raw.customer?.id ? "З обліковим записом" : "Без облікового запису"}</dd><dt>ID клієнта</dt><dd>{selected.raw.customer?.id ?? "Не передано"}</dd><dt>Email</dt><dd>{selected.raw.customer?.email || "Не введено"}</dd></dl>}<p>{selected.raw ? selected.raw.anonymous ? "Анонімний клієнт" : selected.name : selected.contact ? selected.name : "Анонімний клієнт"}</p><small>{selected.contact ? (selected.raw ? `Телефон: ${selected.raw.customer?.phone || selected.raw.checkout_fields["user-phone"]}` : "Телефон: +380 XX XXX XX XX · вигаданий контакт") : "Контактні дані не введені"}</small></div>{selected.raw && <div className={s.detail}><h4>Стан та час</h4><dl className={s.detailGrid}><dt>Поточний етап</dt><dd>{stageName(selected.raw.stage, selected.raw.checkout_step)}</dd><dt>Найвіддаленіший етап API</dt><dd>{stageName(selected.raw.furthest_stage, selected.raw.furthest_checkout_step)}</dd><dt>Створено</dt><dd>{dateTime(selected.raw.created_at)}</dd><dt>Остання зміна</dt><dd>{dateTime(selected.raw.updated_at)}</dd><dt>Позицій товарів</dt><dd>{selected.raw.items_count}</dd><dt>Одиниць товару</dt><dd>{selected.qty}</dd><dt>Валюта</dt><dd>{selected.raw.currency}</dd><dt>Замовлення</dt><dd>{selected.raw.order_id ?? "Ще не створено"}</dd></dl><small>Дати та час — Київ.</small></div>}<div className={s.detail}><h4>Максимально досягнутий етап</h4><p>{stages[selected.stage]}</p><small>Час від останньої зміни: {Math.round(selected.hours * 60)} хв</small></div><div className={s.detail}><h4>Товари</h4>{selected.raw ? selected.raw.items.map((item, index) => <div key={index}><p>{item.url ? <a className="checkout-productLink" href={item.url} target="_blank" rel="noopener noreferrer">{item.name} ↗</a> : item.name}</p><small>{item.sku} · ID {item.id} · {item.type === "product" ? "Товар" : item.type} · {item.qty} од. · {money(item.price)} за одиницю · {money(item.sum)}</small></div>) : <><p>{selected.product}</p><small>{selected.sku} · {selected.qty} од. · {money(selected.total / selected.qty)} за одиницю</small></>}</div>{selected.raw?.delivery_point && <div className={s.detail}><h4>Місце отримання</h4><dl className={s.detailGrid}><dt>Склад</dt><dd>{selected.raw.delivery_point.name || "Назва не передана API"}</dd><dt>ID складу</dt><dd>{selected.raw.delivery_point.warehouse_id ?? "Не передано"}</dd><dt>Місто</dt><dd>{selected.raw.delivery_point.city || "Не передано"}</dd><dt>Адреса</dt><dd>{selected.raw.delivery_point.address || "Не передано"}</dd></dl></div>}<div className={s.detail}><h4>Автозбережені поля checkout</h4>{!live && selected.contact && <p>Ім’я: {selected.name}</p>}{!live && selected.stage >= 2 && <p>Доставка: {selected.delivery}</p>}{!live && selected.stage >= 3 && <p>Оплата: {selected.payment}</p>}{selected.raw && Object.entries(selected.raw.checkout_fields).map(([key, value]) => <p key={key}>{checkoutLabels[key] || key.replace(/[-_]/g, " ")}: {value === null || String(value).trim() === "" ? "Не заповнено" : fieldValue(key, value, selected.raw)}</p>)}{(selected.raw ? !Object.values(selected.raw.checkout_fields).some(value => value !== null && String(value).trim() !== "") : !selected.contact && selected.stage < 2) && <p>Поля ще не введені</p>}<small>Введені значення не підтверджують завершення кроку або згоду на розсилку.</small></div>{selected.status === "converted" && <div className={s.detail}><h4>Замовлення</h4><p>{selected.raw?.order_id ?? `DEMO-${selected.id}`}</p><small>Наявність замовлення не підтверджує його оплату.</small></div>}</div><div className={s.note}>{live ? "Це знімок кошика, а не повна історія сесії. API не передає IP, рекламне джерело, пристрій чи історію переходів. Статус визначає API; вартість кошика не є втраченою виручкою." : "Усі клієнти, товари в кошиках та суми на цій сторінці — демонстраційні."}</div></section></div>}
  </div>;
}
