"use client";

import { useEffect, useState } from "react";
import { PAYMENT_METHOD_LABELS, PAYMENT_STATE_LABELS, orderPaymentState, paymentAmountMismatch, paymentFailureMessage, type OnlinePayment, type OnlinePaymentsDataset, type PaymentState } from "@/lib/online-payments";

export type OnlinePaymentsAnalysisData = Omit<OnlinePaymentsDataset, "payments"> & {
  matchedOrders: number; onlineOrders: number; mappingConfigured: boolean;
};
const tones: Record<PaymentState, string> = {
  success: "#159761", failure: "#cf4242", waiting: "#dd9227", confirmation: "#9967cf",
  hold: "#168b9b", returned: "#316de5", unknown: "#83909c",
};
const money = (amount: number, currency: string) => `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(amount)} ${currency}`;
const time = (value: string | null) => {
  if (!value) return "—";
  const date = new Date(/^\d+$/.test(value) ? Number(value) : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" }).format(date);
};

export function OrderPaymentDetails({ attempts, online, cost, currency, expanded = false }: { attempts: OnlinePayment[]; online: boolean; cost: number; currency: string; expanded?: boolean }) {
  const [details, setDetails] = useState<Record<string, OnlinePayment>>({});
  const [detailUnavailable, setDetailUnavailable] = useState(false);
  const hasAttempts = attempts.length > 0;
  const requestKey = JSON.stringify(attempts.filter((attempt) => attempt.id && attempt.orderId).map((attempt) => ({ id: attempt.id, orderId: attempt.orderId })));
  useEffect(() => {
    setDetails({});
    setDetailUnavailable(false);
    if (!expanded || (!online && !hasAttempts)) return;
    const controller = new AbortController();
    const requests = JSON.parse(requestKey) as Array<{ id: string; orderId: string }>;
    void (async () => {
      for (const attempt of requests) {
        try {
          const response = await fetch(`/api/sales/online-payment?${new URLSearchParams({ order_id: attempt.orderId, payment_id: attempt.id })}`, { signal: controller.signal, cache: "no-store" });
          if (!response.ok) { if (!controller.signal.aborted) setDetailUnavailable(true); continue; }
          const payload = await response.json() as { payment: OnlinePayment };
          if (!controller.signal.aborted) setDetails((current) => ({ ...current, [attempt.id]: payload.payment }));
        } catch { if (!controller.signal.aborted) setDetailUnavailable(true); }
      }
    })();
    return () => controller.abort();
  }, [expanded, online, hasAttempts, requestKey]);
  attempts = attempts.map((attempt) => details[attempt.id] || attempt);
  if (!online && !hasAttempts) return null;
  const state = orderPaymentState(attempts);
  if (!attempts.length) return <div className="mt-1 text-[10px] text-[#83909c]">Статус транзакції не отримано</div>;
  return <div className="mt-2 space-y-2">
    <span className="inline-block rounded-full px-2 py-1 text-[10px] font-bold" style={{ color: tones[state], background: `${tones[state]}14` }}>{state === "success" ? "Успішна транзакція" : PAYMENT_STATE_LABELS[state]}</span>
    {paymentAmountMismatch(attempts, cost, currency) && <p className="text-[10px] text-[#916c21]">Сума успішних оплат відрізняється від вартості замовлення. Потрібна звірка повноти оплати.</p>}
    {expanded && <><div className="text-[10px] font-bold text-[#687582]">Прийнято замовлення → Онлайн-оплата · {attempts.length} спроб</div>
      {detailUnavailable && <p className="text-[10px] text-[#916c21]">Не вдалося уточнити всі спроби. Показано доступні дані архіву.</p>}
      {attempts.map((attempt, index) => <div key={`${attempt.id}-${index}`} className="rounded-lg border border-[#dce4ea] bg-white p-3 text-[10px]">
        <div className="flex flex-wrap justify-between gap-2"><b style={{ color: tones[attempt.state] }}>{PAYMENT_STATE_LABELS[attempt.state]}</b><b>{money(attempt.amount, attempt.currency)}</b></div>
        <div className="mt-1 text-[#687582]">{PAYMENT_METHOD_LABELS[attempt.method] || attempt.method} · ID {attempt.id || "—"} · {time(attempt.updatedAt || attempt.createdAt)}</div>
        {attempt.state === "failure" && <div className="mt-2 text-[#b73535]">{paymentFailureMessage(attempt)}{attempt.errorCode && <> · Код: {attempt.errorCode}</>}</div>}
        {attempt.state === "failure" && attempt.errorDescription && <details className="mt-2 text-[#687582]"><summary className="cursor-pointer">Оригінальна причина LiqPay</summary><p className="mt-1 break-words">{attempt.errorDescription}</p><p className="mt-1">Статус API: {attempt.status}</p></details>}
      </div>)}
    </>}
    {!expanded && state === "failure" && <div className="max-w-[220px] text-[9px] text-[#b73535]">{paymentFailureMessage(attempts.find((attempt) => attempt.state === "failure")!)}</div>}
  </div>;
}

export default function OnlinePaymentsAnalysis({ data, filter, onFilter }: { data?: OnlinePaymentsAnalysisData; filter: string; onFilter: (value: string) => void }) {
  const states = Object.keys(PAYMENT_STATE_LABELS) as PaymentState[];
  const methods = data?.summary.methods || [];
  const successful = methods.reduce((sum, row) => sum + row.count, 0);
  const colors = ["#742cff", "#316de5", "#159761", "#91d3b6", "#f6a000", "#168b9b"];
  let cursor = 0;
  const segments = methods.map((row, index) => {
    const start = cursor; cursor += successful ? row.count / successful * 100 : 0;
    return `${colors[index % colors.length]} ${start}% ${cursor}%`;
  });
  const available = data?.availability === "ready" && data.mappingConfigured;
  return <section className="rounded-2xl border border-[#dfe4ea] bg-white p-5" aria-label="Аналіз онлайн-оплат">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-black text-[#26313d]">Аналіз онлайн-оплат · LiqPay</h2><p className="mt-1 text-[10px] text-[#8a939c]">Транзакції за обраний період, пов’язані з замовленнями за фільтрами. Повторні спроби рахуються окремо.</p></div>{data?.fetchedAt && <span className="text-[10px] text-[#8a939c]">Оновлено: {time(data.fetchedAt)}</span>}</div>
    {!available ? <div className="mt-4 rounded-xl bg-[#fff8e8] p-4 text-xs text-[#916c21]">{!data ? "Завантаження даних онлайн-оплат…" : data.notice || "Потрібно налаштувати відповідність order_id LiqPay і Webshop-замовлення."}</div> : <>
      <div className="mt-4 text-[10px] text-[#687582]">Знайдено платежі для {data.matchedOrders} замовлень, включно з оплатами після вибору іншого способу розрахунку. Онлайн-оплату на сайті обрали {data.onlineOrders} замовлень. Відсутність транзакції в архіві не означає відмову або що клієнт не починав оплату.</div>
      <p className="mt-1 text-[10px] text-[#687582]">Натисніть статус, щоб побачити замовлення з такою спробою. Замовлення з невдалою спробою може вже мати успішну повторну оплату.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-4 xl:grid-cols-8">
        <button type="button" onClick={() => onFilter("all")} aria-pressed={filter === "all"} className={`rounded-xl border p-3 text-left ${filter === "all" ? "border-[#118dff] bg-[#eef7ff]" : "border-[#e8ecef]"}`}><div className="text-[10px] font-bold">Усі спроби</div><b className="mt-2 block text-lg">{data.summary.total}</b></button>
        {states.map((state) => {
          const rows = data.summary.states.filter((row) => row.key === state);
          return <button key={state} type="button" onClick={() => onFilter(filter === state ? "all" : state)} aria-pressed={filter === state} className="rounded-xl border p-3 text-left" style={{ borderColor: filter === state ? tones[state] : "#e8ecef", background: filter === state ? `${tones[state]}10` : "white" }}><div className="text-[10px] font-bold" style={{ color: tones[state] }}>{PAYMENT_STATE_LABELS[state]}</div><b className="mt-2 block text-lg">{rows.reduce((sum, row) => sum + row.count, 0)}</b>{rows.map((row) => <div key={row.currency} className="mt-1 text-[9px] text-[#687582]">{money(row.amount, row.currency)}</div>)}</button>;
        })}
      </div>
      <div className="mt-5 border-t border-[#edf0f2] pt-5"><h3 className="text-xs font-black text-[#33404c]">Успішні оплати за способом оплати</h3><div className="mt-4 grid items-center gap-6 md:grid-cols-[180px_1fr]">
        <div role="img" aria-label={`Розподіл ${successful} успішних транзакцій за способом оплати`} className="relative mx-auto h-44 w-44 rounded-full" style={{ background: segments.length ? `conic-gradient(${segments.join(",")})` : "#edf0f2" }}><div className="absolute inset-6 flex flex-col items-center justify-center rounded-full bg-white"><b className="text-xl">{successful}</b><span className="text-[10px] text-[#83909c]">успішних спроб</span></div></div>
        <div className="space-y-2">{methods.map((row, index) => <div key={`${row.key}-${row.currency}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#f4f6f8] px-4 py-3 text-[11px]"><span className="flex items-center gap-2 font-bold"><i className="h-3 w-3 rounded-full" style={{ background: colors[index % colors.length] }} />{PAYMENT_METHOD_LABELS[row.key] || row.key}</span><span>{money(row.amount, row.currency)} · {row.count} шт · {(row.count / successful * 100).toFixed(1)}%</span></div>)}{!methods.length && <p className="text-xs text-[#83909c]">Успішних транзакцій не знайдено.</p>}</div>
      </div></div>
      <p className="mt-4 text-[10px] text-[#8a939c]">Частки — за кількістю успішних спроб. Суми різних валют показані окремо. Виплати компанії та суми часткових повернень потребують фінансового реєстру і тут не розраховуються.</p>
    </>}
  </section>;
}
