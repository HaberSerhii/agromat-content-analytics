"use client";
import { useEffect, useState } from "react";
import { ProductDailyDynamics } from "@/components/ProductDailyDynamics";
import type { DailyProductPoint } from "@/lib/product-daily-dynamics";
import type { DailyComparisons } from "@/lib/product-daily-comparison";

type DailyData = { points: DailyProductPoint[]; year?: DailyProductPoint[]; summary?: DailyComparisons; error: string };
export function ProductDailyDynamicsPeriod({ data, loading, scope, filters }: { data?: DailyData; loading: boolean; scope: string; filters: string }) {
  const currentMonth = new Date().toLocaleDateString("en-CA", {timeZone:"Europe/Kyiv"}).slice(0,7);
  const [month, setMonth] = useState(currentMonth);
  const [loaded, setLoaded] = useState<{key:string;data:DailyData} | null>(null);
  const [error, setError] = useState<{key:string;text:string} | null>(null);
  const key = `${month}:${filters}`;
  const historical = month !== currentMonth;
  useEffect(() => {
    if (!historical) return;
    const controller = new AbortController();
    fetch("/api/products/dashboard-v2", {method:"POST",headers:{"Content-Type":"application/json"},signal:controller.signal,
      body:JSON.stringify({...JSON.parse(filters),view:"products",page:1,limit:1,dailyMonth:month})})
      .then(async response => {
        const payload=await response.json();
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        if (!controller.signal.aborted) {setLoaded({key,data:payload.productAnalysis.daily});setError(null);}
      })
      .catch(reason => {if (!controller.signal.aborted) setError({key,text:reason instanceof Error ? reason.message : "Не вдалося завантажити місяць"});});
    return () => controller.abort();
  },[historical,month,filters,key]);
  const visible = historical ? (loaded?.key === key ? loaded.data : undefined) : data;
  return <ProductDailyDynamics points={visible?.points || []} year={visible?.year || []} summary={visible?.summary}
    error={error?.key === key ? error.text : visible?.error} loading={historical ? !visible && error?.key !== key : loading} scope={scope}
    month={month} maxMonth={currentMonth} onMonthChange={value => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value <= currentMonth && value >= "2000-01") setMonth(value); }} />;
}
