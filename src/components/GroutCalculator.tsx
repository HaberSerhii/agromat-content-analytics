"use client";

import { useEffect, useState } from "react";
import { calculateGrout, defaultGroutInputs, jointRange, rankGroutProducts, safeProductUrl, type GroutInputs, type GroutProduct } from "@/lib/grout-calculator";
import "./grout-calculator.css";

interface Catalog { products: GroutProduct[]; syncedAt: string; source: string; warning?: string }
const fmt = (value: number, decimals = 2) => new Intl.NumberFormat("uk-UA", { maximumFractionDigits: decimals }).format(value);
const date = (value: string) => new Date(value).toLocaleString("uk-UA");
const presets = [[50, 50], [300, 300], [600, 300], [600, 600], [1200, 600]];

export default function GroutCalculator() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inputs, setInputs] = useState<GroutInputs>(defaultGroutInputs);
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState("");
  const [scope, setScope] = useState("");
  const [inStock, setInStock] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  async function load(refresh = false) {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/grout${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setCatalog(data);
      setSelectedId(previous => data.products.some((p: GroutProduct) => p.id === previous) ? previous : null);
    } catch (e) { setError(e instanceof Error ? e.message : "Не вдалося завантажити каталог."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  const products = catalog?.products || [];
  const selected = products.find(p => p.id === selectedId);
  const brands = [...new Set(products.map(p => p.brand))].sort();
  const scopes = [...new Set(products.flatMap(p => p.attributes.filter(a => /сфера застосування/i.test(a.name)).flatMap(a => a.values)))].sort();
  const filtered = rankGroutProducts(products.filter(p => (!brand || p.brand === brand) && (!inStock || (p.stock ?? 0) > 0) && (!scope || p.attributes.some(a => /сфера застосування/i.test(a.name) && a.values.includes(scope)))), search);
  let result: ReturnType<typeof calculateGrout> | null = null;
  let validation = "";
  try { result = calculateGrout(inputs, selected?.packKg, selected?.price); } catch (e) { validation = e instanceof Error ? e.message : "Перевірте параметри."; }
  const range = selected ? jointRange(selected) : null;
  const mismatch = range && (inputs.joint < range[0] || inputs.joint > range[1]);

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(["АГРОМАТ · Розрахунок затирки", selected?.name, `Плитка ${inputs.length}×${inputs.width} мм; товщина ${inputs.thickness} мм; шов ${inputs.joint}×${inputs.depth} мм; площа ${inputs.area} м².`, `Щільність ${inputs.density} кг/л (введена вручну, перевірити за техкартою).`, `Витрата ${fmt(result.perM2, 3)} кг/м². Із запасом ${inputs.waste}%: ${fmt(result.totalKg)} кг.`, result.packs !== null ? `${result.packs} уп. × ${selected?.packKg} кг.` : "Фасування не визначено.", result.cost !== null ? `Вартість: ${fmt(result.cost)} ${selected?.currency}.` : "", catalog ? `Каталог станом на ${date(catalog.syncedAt)}. ${catalog.warning || ""}` : "", "Орієнтовний розрахунок. Придатність товару потрібно перевірити за техкартою.", selected && safeProductUrl(selected.url)].filter(Boolean).join("\n"));
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch { setError("Не вдалося скопіювати розрахунок. Дозвольте доступ до буфера обміну."); }
  }

  function field(key: keyof GroutInputs, label: string, unit: string) {
    return <label className="gr-field" key={key}><span>{label}</span><div><input aria-label={label} type="number" min={key === "waste" ? 0 : 0.001} max={key === "waste" ? 100 : undefined} step="any" value={Number.isNaN(inputs[key]) ? "" : inputs[key]} onChange={e => setInputs(p => ({ ...p, [key]: e.target.value === "" ? NaN : Number(e.target.value) }))} /><small>{unit}</small></div></label>;
  }

  return <div className="gr-workspace">
    <header className="gr-heading"><div><div className="gr-eyebrow">ІНСТРУМЕНТИ МЕНЕДЖЕРА <span>Локальний прототип</span></div><h1>Затирка: від підбору до розрахунку</h1><p>Реальний асортимент АГРОМАТ, витрата матеріалу, кількість упаковок і вартість.</p></div><button className="gr-button" disabled={loading} onClick={() => void load(true)}>{loading ? "Завантаження…" : "↻ Оновити базу"}</button></header>
    <div className="gr-status"><span className="gr-dot" />{catalog ? <><strong>{products.length} товарів</strong><span>{brands.length} брендів</span><span>Дані: {date(catalog.syncedAt)}</span></> : <span>{loading ? "Підключаємо каталог…" : "Каталог недоступний"}</span>}</div>
    {(error || catalog?.warning) && <div className="gr-warning" role="alert">{error || catalog?.warning}</div>}

    <div className="gr-main-grid">
      <section className="gr-card gr-calculator"><div className="gr-section-heading"><span className="gr-step">01</span><div><h2>Параметри облицювання</h2><p>Усі розміри — у міліметрах</p></div><button className="gr-text-button" onClick={() => setInputs({ ...defaultGroutInputs })}>Скинути</button></div>
        <div className="gr-presets">{presets.map(([l, w]) => <button key={l + "x" + w} className={inputs.length === l && inputs.width === w ? "active" : ""} onClick={() => setInputs(p => ({ ...p, length: l, width: w }))}>{l} × {w}</button>)}</div>
        <div className="gr-tile-diagram" aria-hidden="true"><div className="gr-tiles"><div /><div /><div /><div /></div><span>Шов {Number.isFinite(inputs.joint) ? inputs.joint : "—"} мм</span><small>Схематичне зображення</small></div>
        <div className="gr-fields">{field("length", "Довжина плитки", "мм")}{field("width", "Ширина плитки", "мм")}{field("thickness", "Товщина плитки", "мм")}{field("depth", "Глибина шва", "мм")}{field("joint", "Ширина шва", "мм")}{field("area", "Площа облицювання", "м²")}{field("density", "Щільність затирки", "кг/л")}{field("waste", "Запас матеріалу", "%")}</div>
        <p className="gr-note">Щільність 1,8 взято як початкове припущення з вашого Excel. Це не підтверджене значення для обраного товару. Уточніть його в техкарті та введіть вручну.</p>
        {validation && <div className="gr-warning" role="alert">{validation}</div>}
        {mismatch && <div className="gr-warning" role="alert">Шов {inputs.joint} мм поза діапазоном {range[0]}–{range[1]} мм, зазначеним у картці товару. Змініть параметри або товар.</div>}
        <details className="gr-formula"><summary>Як рахується витрата</summary><p>Q = (A + B) / (A × B) × C × D × ρ</p><p>A, B — розміри плитки; C — ширина шва; D — глибина шва (мм); ρ — щільність (кг/л). Загальна маса = Q × площа × (1 + запас / 100). Кількість упаковок округлюється вгору.</p></details>
      </section>

      <section className="gr-card gr-products"><div className="gr-section-heading"><span className="gr-step">02</span><div><h2>Оберіть затирку з каталогу</h2><p>Фільтри використовують характеристики товарів</p></div></div>
        <input className="gr-search" aria-label="Пошук товарів" placeholder="Назва, колір, артикул або властивість…" value={search} onChange={e => setSearch(e.target.value)} />
        <div className="gr-filters"><select aria-label="Бренд" value={brand} onChange={e => setBrand(e.target.value)}><option value="">Усі бренди</option>{brands.map(b => <option key={b}>{b}</option>)}</select><select aria-label="Сфера застосування" value={scope} onChange={e => setScope(e.target.value)}><option value="">Усі сфери застосування</option>{scopes.map(s => <option key={s}>{s}</option>)}</select></div>
        <div className="gr-product-count"><span>Знайдено: {filtered.length}{selected && !filtered.some(p => p.id === selectedId) ? " · обраний товар поза фільтром" : ""}</span><label><input type="checkbox" checked={inStock} onChange={e => setInStock(e.target.checked)} /> У наявності</label></div>
        <div className="gr-product-list" aria-label="Товари каталогу">{loading && !catalog ? <p className="gr-empty">Завантажуємо актуальні товари та характеристики…</p> : !filtered.length ? <div className="gr-empty"><strong>Товари не знайдені</strong><p>Змініть запит або скиньте фільтри.</p><button className="gr-text-button" onClick={() => { setSearch(""); setBrand(""); setScope(""); setInStock(false); }}>Скинути фільтри</button></div> : filtered.map(p => <button key={p.id} className={`gr-product ${selectedId === p.id ? "selected" : ""}`} onClick={() => setSelectedId(p.id)} aria-pressed={selectedId === p.id}><span className="gr-radio" /><span className="gr-product-info"><strong>{p.name}</strong><small>Код {p.code} · {p.brand} · {p.packKg ? `${fmt(p.packKg)} кг` : "Фасування не вказано"}</small><span className={(p.stock ?? 0) > 0 ? "gr-stock" : "gr-no-stock"}>{p.stock != null ? `Залишок: ${fmt(p.stock)} · ` : ""}{p.status || "Статус не вказано"}</span></span><span className="gr-price">{p.price != null ? fmt(p.price) : "—"}<small>{p.currency}/уп.</small></span></button>)}</div>
        {selected && <details className="gr-product-details"><summary>Характеристики обраного товару · {selected.code}</summary><dl>{selected.attributes.map((a, i) => <div key={i}><dt>{a.name}</dt><dd>{a.values.join(", ")}</dd></div>)}</dl>{!selected.attributes.length && <p className="gr-note">У локальній копії немає технічних характеристик цього товару.</p>}{safeProductUrl(selected.url) && <a target="_blank" rel="noreferrer" href={safeProductUrl(selected.url)!}>Відкрити картку АГРОМАТ ↗</a>}</details>}
      </section>

      <section className="gr-result"><div className="gr-result-top"><div className="gr-eyebrow">ВАШ РОЗРАХУНОК</div><span>Запас {Number.isFinite(inputs.waste) ? inputs.waste : "—"}%</span></div><div className="gr-total">{result ? fmt(result.totalKg) : "—"}<span>кг</span></div><p>Орієнтовна кількість із запасом</p><div className="gr-result-metrics"><div><span>Витрата на 1 м²</span><strong>{result ? fmt(result.perM2, 3) : "—"} кг</strong></div><div><span>Без запасу</span><strong>{result ? fmt(result.baseKg) : "—"} кг</strong></div><div><span>До покупки</span><strong>{result?.packs != null ? `${result.packs} уп. × ${selected?.packKg} кг` : "Оберіть фасування"}</strong></div><div><span>Маса покупки</span><strong>{result?.purchasedKg != null ? `${fmt(result.purchasedKg)} кг` : "—"}</strong></div></div><div className="gr-result-price"><span>Вартість упаковок</span><strong>{result?.cost != null ? `${fmt(result.cost)} ${selected?.currency}` : "—"}</strong></div>{selected ? <p className="gr-selected-name">{selected.name}</p> : <p className="gr-selected-name">Оберіть товар, щоб порахувати упаковки та вартість.</p>}{selected && result?.packs != null && (selected.stock === null ? <p className="gr-result-alert">Наявність потрібної кількості не підтверджена.</p> : selected.stock < result.packs ? <p className="gr-result-alert">Залишок менший за потрібну кількість упаковок.</p> : null)}<button className="gr-copy" disabled={!result} onClick={() => void copy()}>{copied ? "Скопійовано ✓" : "Скопіювати розрахунок"}</button><small className="gr-result-disclaimer">Фактична витрата залежить від основи, заповнення швів і техніки нанесення. Придатність матеріалу перевіряйте за техкартою.</small></section>
    </div>

  </div>;
}
