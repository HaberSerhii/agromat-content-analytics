"use client";

import { useEffect, useState } from "react";
import type { PromotionPricePosition } from "@/lib/promotion-price-position";

type SiteSales = {
  shippedDocs: number;
  shippedRevenue: number;
  reissuedSiteSales: { docs: number; revenue: number };
};

const money = new Intl.NumberFormat("uk-UA", { style: "currency", currency: "UAH" });

export function MarketingSiteSales({ from, to, pricePosition }: {
  from: string; to: string; pricePosition: PromotionPricePosition;
}) {
  const [sales, setSales] = useState<SiteSales | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setSales(null);
    setError("");
    const params = new URLSearchParams({ from, to, channel: "site", compact: "1", price_position: pricePosition });
    fetch(`/api/sales?${params}`, { signal: controller.signal })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Не вдалося завантажити продажі сайту");
        if (!controller.signal.aborted) setSales(payload.summary);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не вдалося завантажити продажі сайту");
      });
    return () => controller.abort();
  }, [from, to, pricePosition]);

  return <section className="rounded-xl border p-4 text-xs" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
    <h3 className="text-sm font-bold">Відвантажені продажі сайту Агромат</h3>
    <p className="mt-1" style={{ color: "var(--text-muted)" }}>За датою відвантаження {from} — {to}, без послуг і за вирахуванням повернень. Враховано обрану цінову позицію. Фільтри кампанії, джерела, трафіку та статусу не застосовуються до цієї звірки.</p>
    {error ? <p className="mt-2 text-red-700" role="alert">{error}</p> : !sales ? <p className="mt-2">Оновлення продажів…</p> : <>
      <p className="mt-3"><b>{money.format(sales.shippedRevenue)}</b> · {sales.shippedDocs} замовлень</p>
      <p className="mt-2">У тому числі переоформлені: <b>{money.format(sales.reissuedSiteSales.revenue)}</b> · {sales.reissuedSiteSales.docs} замовлень.</p>
    </>}
    <p className="mt-2" style={{ color: "var(--text-muted)" }}>Переоформлені замовлення вже входять у продажі сайту. Без зв’язку з початковим замовленням їхня рекламна кампанія залишається невизначеною. Ця сума не додається повторно до замовлень GA4 / UTM нижче.</p>
  </section>;
}
