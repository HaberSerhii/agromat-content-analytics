"use client";

import { useEffect, useRef, useState } from "react";

/** Uses the very same scope and summary as the linked Webshop register. */
export function ReviewPeriodSales({ goodsRefs, from, to }: {
  goodsRefs: number[]; from: string; to?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<{ orders: number; quantity: number; revenue: number } | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const refs = [...new Set(goodsRefs.filter(value => Number.isSafeInteger(value) && value > 0))].sort((a, b) => a - b).join(",");
  const start = from.slice(0, 10);
  const end = to?.slice(0, 10);
  const params = new URLSearchParams({ from: start, to: end || "", goods_refs: refs, origin_source: "webshop" });
  const scope = params.toString();
  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setResult(null); setError(false);
    if (!visible || !end || !refs || start > end) return;
    const controller = new AbortController();
    fetch(`/api/sales/webshop-orders?${scope}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("sales_failed");
        const data = await response.json();
        if (!data.productSales) throw new Error("sales_missing");
        setResult(data.productSales);
      }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [visible, scope, end, refs, start, retry]);
  return <div ref={ref} className="mt-2 min-w-[160px] text-[9px]">
    <div className="font-bold text-[#596571]">Продажі за період обробки</div>
    {!end ? <span className="text-[#a36b0e]">Очікує заміру</span> : <>
      <div className="my-1 text-[8px] text-[#89929b]">{start} — {end}</div>
      {error ? <button type="button" onClick={() => setRetry(value => value + 1)} className="text-[#bd3b3b] underline">Не вдалося завантажити · Повторити</button>
        : <a href={`/sales?view=webshop&${scope}`} target="_blank" rel="noreferrer" className="font-black text-[#118dff] underline" title="Відкрити замовлення цих товарів за цей період у Webshop">
          {result ? `${result.quantity.toLocaleString("uk-UA")} од. · ${result.revenue.toLocaleString("uk-UA", { maximumFractionDigits: 2 })} грн · ${result.orders} замовл.` : "Завантаження…"}
        </a>}
      <div className="mt-1 text-[7px] font-normal text-[#89929b]">Оформлені Webshop-замовлення, усі статуси</div>
    </>}
  </div>;
}
