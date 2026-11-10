"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PromotionInventory } from "@/lib/promotion-inventory";
import { PROMOTION_SALES_SEGMENTS, type PromotionSalesSegment } from "@/lib/promotion-sales-segments";
import type { PromotionPricePosition } from "@/lib/promotion-price-position";

const number = new Intl.NumberFormat("uk-UA");
const formatDate = (value: string) => value.split("-").reverse().join(".");

export function PromotionInventoryCards({ date, segment, pricePosition }: {
  date: string; segment: "all" | PromotionSalesSegment; pricePosition: PromotionPricePosition;
}) {
  const router = useRouter();
  const [inventory, setInventory] = useState<PromotionInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"added" | "removed" | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const scope = `${date}:${segment}:${pricePosition}`;
  const [loadedScope, setLoadedScope] = useState("");
  const ready = !loading && scope === loadedScope && Boolean(inventory?.available);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setOpen(false);
    fetch(`/api/promotions/inventory?${new URLSearchParams({ date, segment, price_position: pricePosition })}`, { signal: controller.signal })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Не вдалося завантажити актуальні акції");
        if (!controller.signal.aborted) { setInventory(payload); setLoadedScope(scope); }
      })
      .catch(reason => { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : "Помилка завантаження"); setInventory(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [date, segment, pricePosition, scope]);

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  const openProducts = (change: "added" | "removed" | null = null) => {
    if (!ready || !inventory) return;
    const key = crypto.randomUUID();
    const label = `${change === "added" ? "Додані акційні товари" : change === "removed" ? "Прибрані акційні товари" : "Акційні товари"} на ${formatDate(inventory.date)}${segment === "all" ? "" : ` · ${PROMOTION_SALES_SEGMENTS[segment]}`}`;
    try {
      sessionStorage.setItem(`promotion-products:${key}`, JSON.stringify({ date: inventory.date, label, productCodes: change ? inventory.changeDetails?.products[change] ?? [] : inventory.productCodes }));
      router.push(`/catalog?promotion_selection=${encodeURIComponent(key)}`);
    } catch { setError("Не вдалося відкрити список товарів. Перевірте доступ до сховища браузера."); }
  };

  const visiblePromotions = direction ? inventory?.changeDetails?.promotions[direction] ?? [] : inventory?.promotions ?? [];
  const openPromotions = (change: "added" | "removed" | null) => { setDirection(change); setOpen(true); };

  const card = (kind: "promotions" | "products") => {
    const isPromotions = kind === "promotions";
    const changes = ready ? inventory?.changes?.[kind] : null;
    return <div
      className="relative rounded-2xl border border-[#dfe4ea] bg-white p-5 text-left shadow-sm transition hover:border-[#9fc9ed] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#118dff] disabled:cursor-default">
      <span className="absolute inset-y-0 left-0 w-1 rounded-l-2xl" style={{ background: isPromotions ? "#118dff" : "#6d5bd0" }} />
      <button type="button" onClick={() => isPromotions ? openPromotions(null) : openProducts()} disabled={!ready} className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#118dff] disabled:cursor-default">
      <span className="block text-[9px] font-black uppercase tracking-[.14em] text-[#8a949e]">{isPromotions ? "Актуальні акційні програми" : "Унікальні акційні товари"}</span>
      <strong className="mt-3 block text-2xl font-black tracking-tight text-[#202a35] sm:text-3xl">{ready && inventory ? number.format(isPromotions ? inventory.promotions.length : inventory.productCodes.length) : "—"}</strong>
      <span className="mt-2 block text-[10px] text-[#78838e]">{loading || (!error && loadedScope !== scope) ? "Завантаження…" : inventory?.available ? `Станом на ${formatDate(inventory.date)} · ${isPromotions ? "Відкрити список акцій" : "Відкрити в аналізі карток товару"}` : "Немає знімка на вибрану дату"}</span>
      </button>
      {changes ? <span className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-bold">{(["added", "removed"] as const).map(change => <button key={change} type="button" onClick={() => isPromotions ? openPromotions(change) : openProducts(change)} className={`${change === "added" ? "text-[#087a55]" : "text-[#c63f3f]"} rounded hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#118dff]`} aria-label={`Показати ${change === "added" ? "додані" : "прибрані"} ${isPromotions ? "акції" : "товари"}: ${changes[change]}`}>{change === "added" ? "+" : "−"}{number.format(changes[change])} {change === "added" ? "додано" : "прибрано"}</button>)}<span className="text-[#8a949e]">за {formatDate(inventory!.date)}</span></span>
        : ready && <span className="mt-3 block text-[10px] text-[#8a949e]">Зміни недоступні: немає знімка за {formatDate(inventory!.previousDate)}</span>}
      {error && <span role="alert" className="mt-2 block text-[10px] text-[#b73535]">{error}</span>}
    </div>;
  };

  return <>
    {card("promotions")}{card("products")}
    <dialog ref={dialog} onClose={() => setOpen(false)} className="m-auto max-h-[85vh] w-[min(1000px,95vw)] rounded-2xl border border-[#dfe4ea] bg-white p-0 shadow-xl backdrop:bg-black/40" aria-labelledby="current-promotions-title">
      <header className="flex items-start justify-between gap-4 border-b border-[#e5e8eb] px-5 py-4"><div><h2 id="current-promotions-title" className="text-sm font-black text-[#26313d]">{direction === "added" ? "Додані акційні програми" : direction === "removed" ? "Прибрані акційні програми" : "Актуальні акційні програми"} на {inventory && formatDate(inventory.date)}</h2><p className="mt-1 text-xs text-[#78838e]">{number.format(visiblePromotions.length)} програм · {segment === "all" ? "Усі категорії" : PROMOTION_SALES_SEGMENTS[segment]}</p></div><button type="button" onClick={() => setOpen(false)} className="rounded-lg border px-3 py-1 text-sm" aria-label="Закрити список акцій">✕</button></header>
      <div className="overflow-x-auto p-3"><table className="w-full text-left text-xs"><thead className="bg-[#f7f9fb] text-[#78838e]"><tr><th className="p-3">ID P2</th><th className="p-3">Акційна програма</th><th className="p-3">Період</th><th className="p-3 text-right">Товарів</th></tr></thead><tbody>{visiblePromotions.map(promotion => <tr key={promotion.idinc} className="border-t border-[#edf0f2]"><td className="p-3 font-bold text-[#118dff]">{promotion.idinc}</td><td className="p-3 font-semibold text-[#34404c]">{promotion.name}</td><td className="whitespace-nowrap p-3 text-[#78838e]">{promotion.startDate ? formatDate(promotion.startDate) : "Без дати"} — {promotion.endDate ? formatDate(promotion.endDate) : "Безстроково"}</td><td className="p-3 text-right font-bold">{number.format(promotion.productCount)}</td></tr>)}</tbody></table>{!visiblePromotions.length && <p className="p-6 text-center text-xs text-[#78838e]">Акцій за вибраними умовами немає</p>}</div>
    </dialog>
  </>;
}
