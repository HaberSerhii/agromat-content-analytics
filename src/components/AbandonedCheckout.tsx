"use client";
import { useEffect, useRef, useState } from "react";
import AbandonedCartsDemo from "./AbandonedCartsDemo";
import type { ApiCart } from "@/lib/cart-types";

export default function AbandonedCheckout({ from, to, refreshTick }: { from: string; to: string; refreshTick: number }) {
  const [data, setData] = useState<{ rows: ApiCart[]; selection: string; fetchedAt: string | null; stale: boolean } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const previousRefresh = useRef(refreshTick);
  const selection = `${from}_${to}_${refreshTick}`;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setData(null);
    const params = new URLSearchParams({ from, to });
    if (previousRefresh.current !== refreshTick) params.set("refresh", "1");
    previousRefresh.current = refreshTick;
    fetch(`/api/sales/carts?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || "Не вдалося завантажити кошики"); return result as { data: ApiCart[]; fetched_at?: string; stale?: boolean }; })
      .then(result => { if (!controller.signal.aborted) setData({ rows: result.data, selection: `${from}_${to}_${refreshTick}`, fetchedAt: result.fetched_at || null, stale: Boolean(result.stale) }); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Помилка завантаження"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [from, to, refreshTick]);
  if (loading || (data && data.selection !== selection)) return <div className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">Завантаження кошиків з Agromat API…</div>;
  if (error) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error}</div>;
  return <>{data?.fetchedAt && <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${data.stale ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-500"}`}>Дані кошиків: {new Date(data.fetchedAt).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" })}{data.stale ? " · показано останній успішний знімок, оновлення очікується" : ""}</div>}<AbandonedCartsDemo apiCarts={data?.rows || []} exportPeriod={{ from, to }} /></>;
}
