"use client";
import { useEffect, useState } from "react";
import AbandonedCartsDemo from "./AbandonedCartsDemo";
import type { ApiCart } from "@/lib/cart-types";

export default function AbandonedCheckout({ from, to, refreshTick }: { from: string; to: string; refreshTick: number }) {
  const [data, setData] = useState<ApiCart[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setData(null);
    fetch(`/api/sales/carts?${new URLSearchParams({ from, to })}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || "Не вдалося завантажити кошики"); return result.data as ApiCart[]; })
      .then(rows => { if (!controller.signal.aborted) setData(rows); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Помилка завантаження"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [from, to, refreshTick]);
  if (loading) return <div className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">Завантаження кошиків з Agromat API…</div>;
  if (error) return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error}</div>;
  return <AbandonedCartsDemo apiCarts={data || []} />;
}
