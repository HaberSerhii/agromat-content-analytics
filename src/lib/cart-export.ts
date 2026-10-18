import type { ApiCart } from "@/lib/cart-types";
import { checkoutLabels, fieldValue } from "@/lib/cart-fields";
import type * as XLSX from "xlsx";

type Value = string | number | boolean | null;
type Row = Record<string, Value>;
export type CartExportPeriod = { from: string; to: string };
const text = (value: unknown) => value == null ? "" : String(value).trim();
const unique = (values: string[]) => [...new Set(values.filter(Boolean))].join("; ");
const stages = ["Кошик", "Контакти", "Доставка", "Оплата", "Замовлення"];
const stageName = (stage: string, step: number | null) => stage === "checkout"
  ? stages[step || 1] || `Крок ${step}` : stage === "cart" ? "Кошик" : stage;
const contact = (cart: ApiCart, field: "name" | "phone" | "email") => text(cart.customer?.[field]) || text(cart.checkout_fields[`user-${field}`]);
const dateTime = (value: string) => Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "medium" }) : "";
const hours = (start: string, end: string) => {
  const value = (Date.parse(end) - Date.parse(start)) / 3_600_000;
  return Number.isFinite(value) ? Math.round(Math.max(0, value) * 100) / 100 : null;
};

/** One row per cart; repeated products and every saved checkout field have their own columns. */
export function abandonedCartExportRows(input: ApiCart[], now = new Date(), period?: CartExportPeriod) {
  const kyivDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" });
  const carts = [...new Map(input.filter(cart => {
    if (cart.status !== "abandoned") return false;
    if (!period) return true;
    const date = Date.parse(cart.created_at);
    if (!Number.isFinite(date)) return false;
    const day = kyivDate.format(new Date(date));
    return day >= period.from && day <= period.to;
  }).map(cart => [cart.id, cart])).values()];
  const groups = new Map<string, ApiCart[]>();
  for (const cart of carts) {
    const ip = text(cart.ip);
    if (ip) groups.set(ip, [...(groups.get(ip) || []), cart]);
  }
  const duplicateHeaders = ["IP", "Кількість кошиків", "ID кошиків", "Клієнти", "Телефони", "Email", "Кошиків з контактом", "Валюти", "Перше створення (Київ)", "Остання зміна (Київ)"];
  const duplicates: Row[] = [...groups].filter(([, rows]) => rows.length > 1)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([ip, rows]) => ({
      "IP": ip, "Кількість кошиків": rows.length, "ID кошиків": rows.map(cart => cart.id).join("; "),
      "Клієнти": unique(rows.map(cart => contact(cart, "name"))), "Телефони": unique(rows.map(cart => contact(cart, "phone"))),
      "Email": unique(rows.map(cart => contact(cart, "email"))),
      "Кошиків з контактом": rows.filter(cart => contact(cart, "phone") || contact(cart, "email")).length,
      "Валюти": unique(rows.map(cart => cart.currency)),
      "Перше створення (Київ)": dateTime(rows.map(cart => cart.created_at).sort((a, b) => Date.parse(a) - Date.parse(b))[0]),
      "Остання зміна (Київ)": dateTime(rows.map(cart => cart.updated_at).sort((a, b) => Date.parse(b) - Date.parse(a))[0]),
    }));
  const beforeDelivery = new Map<string, number>();
  for (const cart of carts) {
    // The furthest stage prevents a return to contacts from appearing as a drop before delivery.
    const reachedDelivery = [
      [cart.stage, cart.checkout_step], [cart.furthest_stage, cart.furthest_checkout_step],
    ].some(([stage, step]) => stage === "checkout" && Number(step) >= 2)
      || cart.order_id != null;
    const ip = text(cart.ip);
    if (!reachedDelivery && ip) beforeDelivery.set(ip, (beforeDelivery.get(ip) || 0) + 1);
  }
  const beforeDeliveryRows: Row[] = [...beforeDelivery]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([ip, count]) => ({ "IP": ip, "Кількість кошиків": count }));
  const checkoutKeys = [...new Set(carts.flatMap(cart => Object.keys(cart.checkout_fields)))].sort();
  const itemCount = Math.max(0, ...carts.map(cart => cart.items.length));
  const details: Row[] = carts.map(cart => {
    const row: Row = {
      "ID кошика": String(cart.id), "Статус": "Покинутий", "Клієнт": contact(cart, "name"),
      "Телефон": contact(cart, "phone"), "Email": contact(cart, "email"),
      "Є контакт": contact(cart, "phone") || contact(cart, "email") ? "Так" : "Ні",
      "Менеджер": "", "Статус обробки": "", "Дата наступного контакту": "", "Коментар менеджера": "",
      "IP": text(cart.ip), "Кошиків з цим IP у вибірці": text(cart.ip) ? groups.get(text(cart.ip))!.length : null,
      "ID клієнта": cart.customer?.id == null ? "" : String(cart.customer.id), "Анонімний": cart.anonymous ? "Так" : "Ні",
      "Поточний етап": stageName(cart.stage, cart.checkout_step), "Крок checkout": cart.checkout_step,
      "Найвіддаленіший етап": stageName(cart.furthest_stage, cart.furthest_checkout_step), "Найвіддаленіший крок": cart.furthest_checkout_step,
      "Створено (Київ)": dateTime(cart.created_at), "Остання зміна (Київ)": dateTime(cart.updated_at),
      "Годин без змін на момент експорту": hours(cart.updated_at, now.toISOString()),
      "Тривалість кошика, год": hours(cart.created_at, cart.updated_at),
      "Сума після знижок, без доставки": cart.total, "Валюта": cart.currency,
      "Промокод": cart.promo_code || "", "Знижка за промокодом": cart.promo_discount,
      "Кількість позицій": cart.items_count, "Кількість одиниць": cart.items.reduce((sum, item) => sum + item.qty, 0),
      "Доставка": fieldValue("delivery-type", cart.checkout_fields["delivery-type"] ?? "", cart),
      "Оплата": fieldValue("payment-type", cart.checkout_fields["payment-type"] ?? "", cart),
      "Тип місця отримання": cart.delivery_point?.type || "", "Місто": cart.delivery_point?.city || "",
      "Місце отримання": cart.delivery_point?.name || "", "Адреса": cart.delivery_point?.address || "",
      "ID складу": cart.delivery_point?.warehouse_id == null ? "" : String(cart.delivery_point.warehouse_id),
      "ID замовлення": cart.order_id == null ? "" : String(cart.order_id),
    };
    for (const key of checkoutKeys) {
      const value = cart.checkout_fields[key];
      row[`Checkout · ${checkoutLabels[key] || key} [${key}]`] = value == null ? "" : fieldValue(key, value, cart);
    }
    for (let index = 0; index < itemCount; index++) {
      const item = cart.items[index];
      const prefix = `Товар ${index + 1} · `;
      for (const [label, value] of Object.entries({ "ID": item ? String(item.id) : "", "Тип": item?.type || "", "Артикул": item?.sku || "", "Назва": item?.name || "", "Кількість": item?.qty ?? null, "Ціна": item?.price ?? null, "Сума": item?.sum ?? null, "URL": item?.url || "" })) row[prefix + label] = value;
    }
    return row;
  });
  return { duplicates, duplicateHeaders, details, beforeDeliveryRows };
}

export function buildAbandonedCartsWorkbook(xlsx: typeof XLSX, carts: ApiCart[], now = new Date(), period?: CartExportPeriod) {
  const { duplicates, duplicateHeaders, details, beforeDeliveryRows } = abandonedCartExportRows(carts, now, period);
  const workbook = xlsx.utils.book_new();
  workbook.Props = {
    Title: "Покинуті кошики",
    Subject: period ? `Дата створення: ${period.from} — ${period.to} (Київ)` : "Поточна вибірка",
    CreatedDate: now,
  };
  for (const [name, rows, headers] of [
    ["Повторювані IP", duplicates, duplicateHeaders],
    ["Покинуті кошики", details, details[0] ? Object.keys(details[0]) : ["ID кошика", "Клієнт", "Телефон", "Email"]],
    ["Не дійшли до доставки", beforeDeliveryRows, ["IP", "Кількість кошиків"]],
  ] as [string, Row[], string[]][]) {
    const sheet = xlsx.utils.json_to_sheet(rows, { header: headers });
    sheet["!autofilter"] = { ref: sheet["!ref"]! };
    sheet["!cols"] = headers.map(header => ({ wch: /коментар|адреса|назва|URL|Checkout|ID кошиків/i.test(header) ? 38 : /телефон|email|клієнт/i.test(header) ? 28 : 24 }));
    xlsx.utils.book_append_sheet(workbook, sheet, name);
  }
  return workbook;
}

export async function downloadAbandonedCarts(carts: ApiCart[], period?: CartExportPeriod) {
  // Capture one selection and timestamp before the asynchronous library load.
  const selection = structuredClone(carts);
  const selectedPeriod = period ? { ...period } : undefined;
  const now = new Date();
  const xlsx = await import("xlsx");
  const workbook = buildAbandonedCartsWorkbook(xlsx, selection, now, selectedPeriod);
  const bytes = xlsx.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `abandoned-carts-${selectedPeriod ? `${selectedPeriod.from}_${selectedPeriod.to}` : now.toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
