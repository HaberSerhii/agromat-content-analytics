"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CONTENT_REVIEW_MANAGERS } from "@/lib/content-review-types";
import type {
  SearchControlResponse,
  SearchControlRow,
} from "@/lib/search-analytics-types";

const SHEET_ID = "12LQc7_q7ok9pufQJCNC-rtIYTc4OCdZwsdww_l_xrJc";
const EMPTY_DATA: SearchControlResponse = {
  rows: [],
  updatedAt: "",
  measurementFrom: null,
  measurementTo: null,
  stats: {
    processedQueries: 0,
    zeroNoResultsQueries: 0,
    uniqueSales: 0,
    ctrScore: 0,
    atcScore: 0,
    productsOutOfStock: 0,
    waitingQueries: 0,
  },
  managers: [],
  warnings: [],
};

function number(value: number): string {
  return new Intl.NumberFormat("uk-UA").format(value || 0);
}

function date(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

function percent(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(2)}%`;
}

function scoreTone(value: number | null): string {
  return value == null || value === 0 ? "#68737e" : value > 0 ? "#087a55" : "#bd3b3b";
}

function Score({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[8px] text-[#929ca5]">немає заміру</span>;
  return (
    <span
      className="ml-1 rounded-full px-1.5 py-0.5 text-[8px] font-black"
      style={{
        color: scoreTone(value),
        background: value > 0 ? "#e9f7f0" : value < 0 ? "#fff0f0" : "#eef1f3",
      }}
    >
      {value > 0 ? "+1" : value < 0 ? "−1" : "0"}
    </span>
  );
}

function OutOfStockModal({ row, onClose }: { row: SearchControlRow; onClose: () => void }) {
  const products = row.products.filter((product) => (product.stockQty || 0) <= 0);
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[#17212bcc]/70 p-3 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between border-b border-[#e8edf1] p-5">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[.16em] text-[#dc5a64]">Товари без залишків</div>
            <h3 className="mt-1 text-lg font-black text-[#27313c]">{row.query}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg bg-[#eef1f3] px-3 py-2 text-xs font-black text-[#596571]">✕</button>
        </header>
        <div className="divide-y divide-[#edf0f2]">
          {products.map((product) => (
            <div key={product.goodsRef} className="flex items-center justify-between gap-3 p-4">
              <div>
                <div className="text-[10px] font-black text-[#27313c]">{product.name}</div>
                <div className="mt-1 text-[8px] text-[#7d8892]">IDD {product.code} · goods_ref {product.goodsRef}</div>
              </div>
              {product.url && <a href={product.url} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg bg-[#edf6ff] px-3 py-2 text-[9px] font-black text-[#0b6fc2]">Товар ↗</a>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SearchControlPanel() {
  const [data, setData] = useState<SearchControlResponse>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [manager, setManager] = useState("all");
  const [minNoResults, setMinNoResults] = useState(false);
  const [decline, setDecline] = useState("all");
  const [outOfStock, setOutOfStock] = useState(false);
  const [stockRow, setStockRow] = useState<SearchControlRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/products/search-control", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as SearchControlResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setData(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не вдалося завантажити контроль");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("uk");
    return data.rows.filter((row) => {
      if (normalizedSearch && ![row.query, row.queryUk, row.queryRu, ...row.aliases].some((value) => value.toLocaleLowerCase("uk").includes(normalizedSearch))) return false;
      if (manager !== "all" && row.manager !== manager) return false;
      if (minNoResults && (row.multisearchNoResultsCount == null || row.multisearchNoResultsCount <= 1)) return false;
      if (decline === "any" && row.ctrScore !== -1 && row.atcScore !== -1) return false;
      if (decline === "ctr" && row.ctrScore !== -1) return false;
      if (decline === "atc" && row.atcScore !== -1) return false;
      if (outOfStock && row.productsOutOfStock <= 0) return false;
      return true;
    });
  }, [data.rows, decline, manager, minNoResults, outOfStock, search]);

  const kpis = [
    { label: "Опрацьовано запитів", value: data.stats.processedQueries, note: `${data.stats.waitingQueries} очікують першого заміру`, color: "#118dff" },
    { label: "MS без результату = 0", value: data.stats.zeroNoResultsQueries, note: "за останній контрольний місяць", color: "#23a875" },
    { label: "Унікальні продажі", value: data.stats.uniqueSales, note: "унікальні чеки з залученими товарами", color: "#f39c4a" },
    { label: "Ефект CTR", value: data.stats.ctrScore, note: "+1 покращення · −1 погіршення", color: scoreTone(data.stats.ctrScore) },
    { label: "Ефект ATC", value: data.stats.atcScore, note: "+1 покращення · −1 погіршення", color: scoreTone(data.stats.atcScore) },
    { label: "Товарів без залишків", value: data.stats.productsOutOfStock, note: "унікальні IDD у запитах", color: "#dc5a64" },
  ];

  return (
    <div className="space-y-4">
      {stockRow && <OutOfStockModal row={stockRow} onClose={() => setStockRow(null)} />}
      <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
        <div className="flex flex-col gap-3 border-b border-[#e8edf1] bg-[#fbfcfd] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[.14em] text-[#6556d8]">Щомісячний контроль</div>
            <h2 className="mt-1 text-sm font-black text-[#27313c]">Ефективність пошукових запитів за менеджерами</h2>
            <p className="mt-1 text-[10px] leading-4 text-[#7d8892]">
              Перша перевірка — після повного календарного місяця. Поточний контрольний період: <b>{date(data.measurementFrom)} — {date(data.measurementTo)}</b>.
            </p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="self-start rounded-xl border border-[#bcd8f1] bg-[#edf6ff] px-3 py-2 text-[10px] font-black text-[#0b6fc2] disabled:opacity-50">
            {loading ? "Оновлюємо…" : "Оновити"}
          </button>
        </div>
        {error && <div className="border-b border-[#f0b6b6] bg-[#fff1f1] p-3 text-[10px] font-bold text-[#b73535]">{error}</div>}
        {data.warnings.map((warning) => <div key={warning} className="border-b border-[#f0d4a5] bg-[#fff8eb] px-4 py-2 text-[9px] text-[#9a6616]">{warning}</div>)}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {kpis.map((item) => (
          <article key={item.label} className="rounded-2xl border border-[#dfe4ea] bg-white p-4">
            <div className="text-[8px] font-black uppercase tracking-[.11em] text-[#82909d]">{item.label}</div>
            <div className="mt-2 text-2xl font-black" style={{ color: item.color }}>{item.value > 0 && item.label.startsWith("Ефект") ? "+" : ""}{number(item.value)}</div>
            <div className="mt-1 text-[8px] leading-4 text-[#7d8892]">{item.note}</div>
          </article>
        ))}
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        {data.managers.map((item) => (
          <article key={item.manager} className="rounded-2xl border border-[#dfe4ea] bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-black text-[#27313c]">{item.manager}</div>
              <div className="rounded-full bg-[#edf6ff] px-3 py-1 text-[9px] font-black text-[#0b6fc2]">{item.queries} запитів</div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-[#f5f7f9] p-2"><b className="text-sm text-[#45515d]">{item.measured}</b><div className="text-[7px] text-[#8a949e]">заміряно</div></div>
              <div className="rounded-xl bg-[#eef9f4] p-2"><b className="text-sm text-[#087a55]">CTR +{item.improvedCtr} / −{item.declinedCtr}</b><div className="text-[7px] text-[#719083]">покращено / гірше</div></div>
              <div className="rounded-xl bg-[#f2f0ff] p-2"><b className="text-sm text-[#6556d8]">ATC +{item.improvedAtc} / −{item.declinedAtc}</b><div className="text-[7px] text-[#80799c]">покращено / гірше</div></div>
            </div>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-[#dfe4ea] bg-white">
        <div className="border-b border-[#e8edf1] bg-[#fbfcfd] p-4">
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Знайти пошуковий запит…" className="rounded-xl border border-[#d8dde3] bg-white px-3 py-2.5 text-[10px] outline-none focus:border-[#118dff]" />
            <select value={manager} onChange={(event) => setManager(event.target.value)} className="rounded-xl border border-[#d8dde3] bg-white px-3 py-2.5 text-[10px] font-bold text-[#596571]">
              <option value="all">Усі менеджери</option>
              {CONTENT_REVIEW_MANAGERS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select value={decline} onChange={(event) => setDecline(event.target.value)} className="rounded-xl border border-[#d8dde3] bg-white px-3 py-2.5 text-[10px] font-bold text-[#596571]">
              <option value="all">Будь-яка ефективність</option>
              <option value="any">Погіршився CTR або ATC</option>
              <option value="ctr">Погіршився CTR</option>
              <option value="atc">Погіршився ATC</option>
            </select>
            <button type="button" onClick={() => setMinNoResults((value) => !value)} className="rounded-xl border px-3 py-2.5 text-[10px] font-black" style={minNoResults ? { borderColor: "#dc5a64", background: "#fff0f1", color: "#bd3b3b" } : { borderColor: "#d8dde3", background: "white", color: "#596571" }}>MS без результату &gt; 1</button>
            <button type="button" onClick={() => setOutOfStock((value) => !value)} className="rounded-xl border px-3 py-2.5 text-[10px] font-black" style={outOfStock ? { borderColor: "#dc5a64", background: "#fff0f1", color: "#bd3b3b" } : { borderColor: "#d8dde3", background: "white", color: "#596571" }}>Є товари без залишків</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-[#f6f8f9] text-[8px] font-black uppercase tracking-[.1em] text-[#8b949e]">
              <tr>
                <th className="px-4 py-3">Пошуковий запит</th>
                <th className="px-3 py-3 text-center">MS без результату</th>
                <th className="px-3 py-3 text-center">Унікальні чеки</th>
                <th className="px-3 py-3">CTR / ATC на старті</th>
                <th className="px-3 py-3">CTR / ATC на замірі</th>
                <th className="px-3 py-3 text-center">Без залишків</th>
                <th className="px-3 py-3">Менеджер</th>
                <th className="px-4 py-3">Дата оновлення</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-[#edf0f2] last:border-0 hover:bg-[#fbfcfd]">
                  <td className="min-w-[270px] px-4 py-3">
                    <div className="text-[11px] font-black text-[#27313c]">{row.query}</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <a href={`https://www.agromat.ua/search/?q=${encodeURIComponent(row.queryUk || row.query)}`} target="_blank" rel="noreferrer" className="rounded-md bg-[#edf6ff] px-2 py-1 text-[8px] font-black text-[#0b6fc2]">Пошук на сайті ↗</a>
                      {row.sheetRow ? <a href={`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=0&range=A${row.sheetRow}:C${row.sheetRow}`} target="_blank" rel="noreferrer" className="rounded-md bg-[#eaf7f1] px-2 py-1 text-[8px] font-black text-[#087a55]">Рядок {row.sheetRow} у Sheets ↗</a> : <span className="rounded-md bg-[#fff7e8] px-2 py-1 text-[8px] font-bold text-[#a56a0b]">Ще не в Sheets</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center">
                    {row.multisearchNoResultsCount == null ? <span className="text-[9px] text-[#929ca5]">з {date(row.checkAt)}</span> : <span className="inline-flex min-w-8 justify-center rounded-full px-2 py-1 text-[10px] font-black" style={{ color: row.multisearchNoResultsCount === 0 ? "#087a55" : "#bd3b3b", background: row.multisearchNoResultsCount === 0 ? "#eaf7f1" : "#fff0f0" }}>{number(row.multisearchNoResultsCount)}</span>}
                  </td>
                  <td className="px-3 py-3 text-center text-[11px] font-black text-[#34404c]">{row.uniqueSales == null ? "—" : number(row.uniqueSales)}</td>
                  <td className="min-w-[145px] px-3 py-3">
                    <div className="text-[10px] font-black text-[#118dff]">CTR {percent(row.before.ctr)}</div>
                    <div className="mt-1 text-[10px] font-black text-[#6556d8]">ATC {percent(row.before.atc)}</div>
                    <div className="mt-1 text-[7px] text-[#929ca5]">{date(row.before.periodFrom)} — {date(row.before.periodTo)}</div>
                  </td>
                  <td className="min-w-[165px] px-3 py-3">
                    {row.after ? <><div className="text-[10px] font-black text-[#118dff]">CTR {percent(row.after.ctr)} <Score value={row.ctrScore} /></div><div className="mt-1 text-[10px] font-black text-[#6556d8]">ATC {percent(row.after.atc)} <Score value={row.atcScore} /></div><div className="mt-1 text-[7px] text-[#929ca5]">{date(row.after.periodFrom)} — {date(row.after.periodTo)}</div></> : <div className="rounded-lg bg-[#f5f7f9] px-2 py-2 text-[8px] font-bold text-[#7d8892]">Перший замір {date(row.checkAt)}</div>}
                  </td>
                  <td className="px-3 py-3 text-center">{row.productsOutOfStock > 0 ? <button type="button" onClick={() => setStockRow(row)} className="rounded-full bg-[#fff0f0] px-2.5 py-1 text-[10px] font-black text-[#bd3b3b] underline decoration-dotted">{row.productsOutOfStock}</button> : <span className="text-[10px] font-black text-[#087a55]">0</span>}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-[9px] font-black text-[#45515d]">{row.manager}</td>
                  <td className="whitespace-nowrap px-4 py-3"><div className="text-[10px] font-black text-[#45515d]">{date(row.updatedAt)}</div><div className="mt-1 text-[7px] text-[#929ca5]">новий цикл заміру</div></td>
                </tr>
              ))}
              {!loading && !rows.length && <tr><td colSpan={8} className="p-12 text-center text-xs text-[#82909d]">Запитів за вибраними умовами не знайдено</td></tr>}
              {loading && !data.rows.length && <tr><td colSpan={8} className="p-12 text-center text-xs text-[#82909d]">Розраховуємо контрольні показники…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="border-t border-[#e8edf1] bg-[#fbfcfd] px-4 py-3 text-[9px] text-[#7d8892]">Показано {number(rows.length)} з {number(data.rows.length)} опрацьованих запитів</div>
      </section>
    </div>
  );
}
