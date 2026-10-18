import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { sourceLoader } from "./helpers/load-source.mjs";

const { abandonedCartExportRows, buildAbandonedCartsWorkbook } = sourceLoader() ("@/lib/cart-export");
const cart = (id, overrides = {}) => ({
  id, ip: "192.0.2.1", status: "abandoned", stage: "checkout", checkout_step: 2,
  furthest_stage: "checkout", furthest_checkout_step: 3, anonymous: true, customer: null,
  items: [{ type: "product", id: 8, sku: "00123", name: "=1+1", qty: 2, price: 25, sum: 50 }],
  items_count: 1, total: 40, currency: "UAH", promo_code: "SAVE", promo_discount: 10,
  checkout_fields: { "user-phone": "+380001234567", "user-name": "Клієнт", "payment-type": "online_full", "custom-field": false },
  order_id: null, created_at: "2026-10-17T08:00:00Z", updated_at: "2026-10-17T10:00:00Z", ...overrides,
});

test("export groups only distinct abandoned carts with nonempty repeated IPs", () => {
  const result = abandonedCartExportRows([cart(1), cart(1), cart(2, { ip: " 192.0.2.1 " }), cart(3, { status: "converted" }), cart(4, { ip: null }), cart(5, { ip: " " })]);
  assert.equal(result.details.length, 4);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.duplicates[0]["Кількість кошиків"], 2);
  assert.equal(result.duplicates[0]["ID кошиків"], "1; 2");
});

test("saved XLSX preserves contacts, money, dynamic fields, multiple products and literal strings", () => {
  const workbook = buildAbandonedCartsWorkbook(XLSX, [cart(1), cart(2, {
    items: [cart(1).items[0], { type: "product", id: 9, sku: "00099", name: "Другий", qty: 1, price: 10, sum: 10 }],
    checkout_fields: { "recipient-phone": "+380009876543" },
  })], new Date("2026-10-17T11:00:00Z"));
  const saved = XLSX.read(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
  assert.deepEqual(saved.SheetNames, ["Повторювані IP", "Покинуті кошики", "Не дійшли до доставки"]);
  const sheet = saved.Sheets["Покинуті кошики"];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  assert.equal(rows[0]["Телефон"], "+380001234567");
  assert.equal(rows[0]["Сума після знижок, без доставки"], 40);
  assert.equal(rows[0]["Товар 1 · Артикул"], "00123");
  assert.equal(rows[0]["Товар 1 · Назва"], "=1+1");
  assert.equal(rows[1]["Товар 2 · Артикул"], "00099");
  assert.equal(rows[0]["Оплата"], "Онлайн · повна оплата");
  assert.equal(rows[0]["Checkout · custom-field [custom-field]"], "Ні");
  assert.equal(rows[1]["Checkout · Телефон отримувача [recipient-phone]"], "+380009876543");
  assert.equal(rows[0]["Годин без змін на момент експорту"], 1);
  assert.equal(rows[0]["Менеджер"], "");
  assert.ok(sheet["!autofilter"]);
  assert.equal(Object.values(sheet).filter(cell => cell?.f).length, 0);
});

test("empty export and a single IP still produce three sheets with headers", () => {
  for (const carts of [[], [cart(1)]]) {
    const workbook = buildAbandonedCartsWorkbook(XLSX, carts);
    assert.equal(workbook.SheetNames.length, 3);
    assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets["Повторювані IP"]).length, 0);
    assert.ok(workbook.Sheets["Повторювані IP"].A1);
  }
});

test("third sheet counts unique abandoned carts before delivery, using furthest reached step", () => {
  const early = cart(1, { stage: "cart", checkout_step: null, furthest_stage: "cart", furthest_checkout_step: null });
  const contacts = cart(2, { checkout_step: 1, furthest_checkout_step: 1 });
  const result = abandonedCartExportRows([
    early, early, contacts,
    cart(3, { checkout_step: 1, furthest_checkout_step: 2 }), // returned from delivery
    cart(4, { checkout_step: 2, furthest_checkout_step: 1 }), // currently at delivery
    cart(5), // payment
    cart(6, { ...contacts, id: 6, ip: "192.0.2.2" }),
    cart(7, { ...contacts, id: 7, ip: " " }),
    cart(8, { ...contacts, id: 8, status: "active" }),
  ]);
  assert.equal(JSON.stringify(result.beforeDeliveryRows), JSON.stringify([
    { IP: "192.0.2.1", "Кількість кошиків": 2 },
    { IP: "192.0.2.2", "Кількість кошиків": 1 },
  ]));
});

test("one Kyiv creation-date selection applies to every saved sheet, including final-day boundaries", () => {
  const early = { stage: "checkout", checkout_step: 1, furthest_stage: "checkout", furthest_checkout_step: 1 };
  const rows = [
    cart(1, { ...early, created_at: "2026-10-16T21:00:00Z" }), // Oct 17 at 00:00 Kyiv
    cart(2, { ...early, created_at: "2026-10-17T20:59:59Z" }), // Oct 17 at 23:59:59
    cart(3, { ...early, created_at: "2026-10-17T21:00:00Z" }), // Oct 18
    cart(4, { ...early, created_at: "2026-10-16T20:59:59Z" }), // Oct 16
  ];
  const now = new Date("2026-10-18T11:00:00Z");
  for (const [period, expected] of [[{ from: "2026-10-17", to: "2026-10-17" }, 2], [{ from: "2026-10-16", to: "2026-10-18" }, 4]]) {
    const workbook = buildAbandonedCartsWorkbook(XLSX, rows, now, period);
    const saved = XLSX.read(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
    assert.equal(XLSX.utils.sheet_to_json(saved.Sheets["Покинуті кошики"]).length, expected);
    assert.equal(XLSX.utils.sheet_to_json(saved.Sheets["Повторювані IP"])[0]["Кількість кошиків"], expected);
    const third = XLSX.utils.sheet_to_json(saved.Sheets["Не дійшли до доставки"]);
    assert.equal(third[0]["Кількість кошиків"], expected);
    assert.deepEqual(Object.keys(third[0]), ["IP", "Кількість кошиків"]);
    assert.ok(saved.Props.Subject.includes(`${period.from} — ${period.to}`));
  }
});
