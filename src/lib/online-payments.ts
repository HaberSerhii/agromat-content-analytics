export type PaymentState = "success" | "failure" | "waiting" | "confirmation" | "hold" | "returned" | "unknown";
export type OnlinePayment = {
  id: string; orderId: string; status: string; state: PaymentState;
  amount: number; currency: string; method: string;
  createdAt: string | null; updatedAt: string | null;
  errorCode: string | null; errorDescription: string | null;
};
export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  success: "Успішні", failure: "Неуспішні", waiting: "Очікують",
  confirmation: "Потребують підтвердження", hold: "Кошти заблоковано",
  returned: "Повернені", unknown: "Статус невідомий",
};
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  applepay: "Apple Pay", googlepay: "Google Pay", privat24: "PrivatPay",
  card: "Картка", gpaycard: "Google Pay · gpaycard", paypart: "Оплата частинами", moment_part: "Оплата частинами", token: "Токен картки",
  liqpay: "LiqPay", invoice: "Інвойс", qr: "QR",
};
export function normalizePaymentMethod(value: string): string {
  if (["apay", "apay_tavv", "applepay"].includes(value)) return "applepay";
  if (["gpay", "gpay_tavv", "googlepay"].includes(value)) return "googlepay";
  return value;
}
export function paymentState(status: string): PaymentState {
  if (["success", "wait_compensation"].includes(status)) return "success";
  if (["failure", "error", "try_again"].includes(status)) return "failure";
  if (status === "reversed") return "returned";
  if (status === "hold_wait") return "hold";
  if (status.endsWith("_verify") || status === "wait_qr") return "confirmation";
  if (["prepared", "processing", "cash_wait", "invoice_wait", "wait_accept", "wait_card", "wait_lc", "wait_reserve", "wait_secure"].includes(status)) return "waiting";
  return "unknown";
}
const text = (value: unknown): string | null => value == null || value === "" ? null : String(value);
export function normalizePayment(row: Record<string, unknown>): OnlinePayment {
  const status = text(row.status) || "unknown";
  const amount = Number(row.amount);
  return {
    id: text(row.payment_id) || text(row.transaction_id) || text(row.liqpay_order_id) || "",
    orderId: text(row.order_id) || "", status, state: paymentState(status),
    amount: Number.isFinite(amount) ? amount : 0,
    currency: text(row.currency) || "UNKNOWN", method: normalizePaymentMethod(text(row.paytype) || "unknown"),
    createdAt: text(row.create_date), updatedAt: text(row.end_date),
    errorCode: text(row.err_code), errorDescription: text(row.err_description),
  };
}
/** Latest state per payment, retaining distinct retry IDs. */
export function deduplicatePayments(payments: OnlinePayment[]): OnlinePayment[] {
  const unique = new Map<string, OnlinePayment>();
  const anonymous: OnlinePayment[] = [];
  for (const payment of payments) {
    if (!payment.id) { anonymous.push(payment); continue; }
    const previous = unique.get(payment.id);
    const stamp = (value: string | null) => value && /^\d+$/.test(value) ? Number(value) : Date.parse(value || "") || 0;
    if (!previous || stamp(payment.updatedAt || payment.createdAt) >= stamp(previous.updatedAt || previous.createdAt)) unique.set(payment.id, payment);
  }
  return [...unique.values(), ...anonymous];
}
export function summarizePayments(payments: OnlinePayment[]) {
  const buckets = new Map<string, { key: string; currency: string; count: number; amount: number }>();
  const methods = new Map<string, { key: string; currency: string; count: number; amount: number }>();
  for (const payment of payments) {
    const add = (map: typeof buckets, key: string) => {
      const id = `${key}|${payment.currency}`;
      const bucket = map.get(id) || { key, currency: payment.currency, count: 0, amount: 0 };
      bucket.count++; bucket.amount += payment.amount; map.set(id, bucket);
    };
    add(buckets, payment.state);
    if (payment.state === "success") add(methods, payment.method);
  }
  return { total: payments.length, states: [...buckets.values()], methods: [...methods.values()].sort((a, b) => b.count - a.count) };
}
export function orderPaymentState(attempts: OnlinePayment[]): PaymentState {
  if (attempts.some((attempt) => attempt.state === "success")) return "success";
  const stamp = (value: string | null) => value && /^\d+$/.test(value) ? Number(value) : Date.parse(value || "") || 0;
  const latest = [...attempts].sort((a, b) => stamp(b.updatedAt || b.createdAt) - stamp(a.updatedAt || a.createdAt))[0];
  return latest?.state || "unknown";
}
export type OnlinePaymentsDataset = {
  availability: "ready" | "not_configured" | "error";
  notice: string | null; fetchedAt: string | null;
  payments: OnlinePayment[]; summary: ReturnType<typeof summarizePayments>;
};

/** Prefix i_ identifies a website order; o_ identifies ERP and is never inferred here. */
export function indexOrderPayments(payments: OnlinePayment[]) {
  const exact = new Map<string, OnlinePayment[]>();
  const website = new Map<string, OnlinePayment[]>();
  for (const payment of payments) {
    const add = (index: Map<string, OnlinePayment[]>, key: string) => {
      const rows = index.get(key) || []; rows.push(payment); index.set(key, rows);
    };
    add(exact, payment.orderId);
    const match = /^i_(\d+)_[A-Za-z0-9]+$/.exec(payment.orderId);
    if (match) add(website, match[1]);
  }
  return { exact, website };
}
export function matchOrderPayments(
  order: { id: number | string; order_num?: number | string | null; payment?: { order_id?: string; liqpay_order_id?: string } | null },
  payments: OnlinePayment[] | ReturnType<typeof indexOrderPayments>, mapping?: string,
): OnlinePayment[] {
  const index = Array.isArray(payments) ? indexOrderPayments(payments) : payments;
  const explicit = order.payment?.order_id || order.payment?.liqpay_order_id;
  const configured = mapping === "id" ? String(order.id) : mapping === "order_num" && order.order_num != null ? String(order.order_num) : null;
  return deduplicatePayments([
    ...(index.website.get(String(order.id)) || []),
    ...(explicit ? index.exact.get(explicit) || [] : []),
    ...(configured ? index.exact.get(configured) || [] : []),
  ]);
}

export function paymentAmountMismatch(attempts: OnlinePayment[], cost: number, currency: string): boolean {
  const successful = deduplicatePayments(attempts).filter((attempt) => attempt.state === "success");
  return successful.length > 0 && (successful.some((attempt) => attempt.currency !== currency)
    || Math.abs(successful.reduce((sum, attempt) => sum + attempt.amount, 0) - cost) >= 0.011);
}

/** Display a verified translation; preserve provider text separately for support. */
export function paymentFailureMessage(payment: Pick<OnlinePayment, "errorCode" | "errorDescription">): string {
  const original = payment.errorDescription?.trim();
  if (!original) return payment.errorCode === "expired_3ds" ? "Час підтвердження оплати минув. Спробуйте оплатити ще раз." : "Причина не передана LiqPay";
  const key = original.toLowerCase().replace(/[.!]+$/, "").replace(/\s+/g, " ");
  const translations: Record<string, string> = {
    "insufficient funds": "Недостатньо коштів на картці",
    "withdrawal limit already reached": "Досягнуто ліміт списання коштів із картки",
    "your payment session has timed out": "Час підтвердження оплати минув. Спробуйте оплатити ще раз.",
    "failed to make payment. please make sure the parameters are entered correctly and try again": "Не вдалося виконати платіж. Перевірте введені дані та спробуйте ще раз.",
    "card expired": "Термін дії картки минув",
    "expired card": "Термін дії картки минув",
    "invalid card number": "Неправильний номер картки",
    "transaction declined": "Транзакцію відхилено",
    "payment declined": "Платіж відхилено",
  };
  if (translations[key]) return translations[key];
  if (/[іїєґ]/i.test(original)) return original;
  return "Платіж не виконано. Оригінальна причина доступна в деталях платежу.";
}
