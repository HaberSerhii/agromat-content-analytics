import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sourceLoader } from "./helpers/load-source.mjs";

const load = sourceLoader();
const { paymentState, normalizePayment, deduplicatePayments, summarizePayments, orderPaymentState, matchOrderPayments, paymentAmountMismatch, paymentFailureMessage } = load("@/lib/online-payments");
const { archiveWindows, liqpaySignature, readOnlinePayments } = load("@/lib/liqpay");
const payment = (id, status, amount = 100, currency = "UAH", end_date = "1720000000000") => normalizePayment({ payment_id: id, order_id: "order-1", status, amount, currency, paytype: "card", end_date });

test("payment classifications do not confuse API success, subscriptions, holds and compensation", () => {
  assert.equal(paymentState("wait_compensation"), "success");
  assert.equal(paymentState("hold_wait"), "hold");
  assert.equal(paymentState("subscribed"), "unknown");
  assert.equal(paymentState("otp_verify"), "confirmation");
  assert.equal(paymentState("wait_secure"), "waiting");
  assert.equal(paymentState("new_provider_status"), "unknown");
});
test("retry success wins over a failed attempt, but reversed latest payment replaces its success", () => {
  const failed = payment("one", "failure");
  const success = payment("two", "success");
  assert.equal(orderPaymentState([failed, success]), "success");
  const reversed = payment("two", "reversed", 100, "UAH", "1730000000000");
  const result = deduplicatePayments([success, reversed, failed]);
  assert.equal(result.length, 2);
  assert.equal(orderPaymentState(result), "returned");
});
test("statistics retain retries, separate currencies and exclude failed payments from method shares", () => {
  const summary = summarizePayments([payment("1", "failure"), payment("2", "success"), payment("3", "success", 20, "EUR")]);
  assert.equal(summary.total, 3);
  assert.equal(summary.methods.length, 2);
  assert.equal(summary.methods.find((row) => row.currency === "UAH").amount, 100);
});
test("errors remain provider supplied, unknown reasons are not invented; sensitive fields are stripped", () => {
  const value = normalizePayment({ status: "failure", err_code: "9859", err_description: "Недостатньо коштів", sender_phone: "private", card_token: "secret" });
  assert.equal(value.errorCode, "9859");
  assert.equal(value.errorDescription, "Недостатньо коштів");
  assert.equal("sender_phone" in value, false);
  assert.equal("card_token" in value, false);
  assert.equal(payment("1", "failure").errorDescription, null);
});
test("archive windows are contiguous and respect Kyiv daylight saving boundaries", () => {
  const windows = archiveWindows("2026-10-01", "2026-11-30");
  assert.equal(windows[0].date_from, Date.parse("2026-10-01T00:00:00+03:00"));
  assert.equal(windows.at(-1).date_to, Date.parse("2026-12-01T00:00:00+02:00") - 1);
  for (let i = 1; i < windows.length; i++) assert.equal(windows[i].date_from, windows[i - 1].date_to + 1);
  assert.throws(() => archiveWindows("2026-02-30", "2026-03-10"));
  assert.throws(() => archiveWindows("2026-10-02", "2026-10-01"));
});
test("v7 signing uses the binary SHA3-256 digest", () => {
  assert.equal(liqpaySignature("data", "private"), createHash("sha3-256").update("privatedataprivate").digest("base64"));
});
test("missing keys return an unavailable dataset instead of paid-zero statistics", async () => {
  const result = await readOnlinePayments("2026-09-01", "2026-09-30");
  assert.equal(result.availability, "not_configured");
  assert.equal(result.payments.length, 0);
  assert.equal(result.fetchedAt, null);
});

test("provider payment errors are returned as payment data, API authentication errors are rejected", async () => {
  let payload = { payment_id: "123", order_id: "order", status: "failure", result: "error", err_code: "9859" };
  const reader = sourceLoader({ globals: {
    process: { env: { LIQPAY_PUBLIC_KEY: "test", LIQPAY_PRIVATE_KEY: "test-secret" } },
    AbortSignal,
    fetch: async () => ({ ok: true, json: async () => payload }),
  } })("@/lib/liqpay");
  assert.equal((await reader.liqpayRead("status", { order_id: "order" })).err_code, "9859");
  payload = { status: "error", err_code: "invalid_signature" };
  await assert.rejects(reader.liqpayRead("status", { order_id: "order" }));
});

test("payment detail endpoint protects access and refuses to substitute another retry", async () => {
  let authenticated = false;
  let payload = { payment_id: "new-attempt", order_id: "order", status: "success" };
  const route = sourceLoader({ mocks: {
    "next/server": { NextResponse: { json: (body, init) => ({ body, status: init?.status || 200 }) } },
    "@/lib/dashboard-auth": { isDashboardRequest: () => authenticated },
    "@/lib/liqpay": { liqpayRead: async () => payload },
    "@/lib/server-result-cache": { getServerResult: async ({ load }) => ({ value: await load() }) },
  } })("@/app/api/sales/online-payment/route");
  const request = { url: "http://localhost/api/sales/online-payment?order_id=order&payment_id=old-attempt" };
  assert.equal((await route.GET(request)).status, 401);
  authenticated = true;
  assert.equal((await route.GET(request)).status, 409);
  payload = { payment_id: "old-attempt", order_id: "order", status: "failure", err_description: "Provider reason" };
  const response = await route.GET(request);
  assert.equal(response.status, 200);
  assert.equal(response.body.payment.errorDescription, "Provider reason");
});

test("Apple and Google token payment variants are grouped by wallet", () => {
  assert.equal(normalizePayment({ paytype: "apay_tavv" }).method, "applepay");
  assert.equal(normalizePayment({ paytype: "gpay" }).method, "googlepay");
});

test("confirmed website prefixes retain all retries and do not confuse ERP or document numbers", () => {
  const make = (id, order_id) => normalizePayment({ payment_id: id, order_id, status: "success", amount: 100, currency: "UAH" });
  const rows = [make("1", "i_38441_77"), make("2", "i_38441_st"), make("3", "i_38441_fO"), make("4", "o_38441_77"), make("5", "i_30386_st")];
  const order = { id: 38441, order_num: "30386", payment: { type: "cash" } };
  assert.deepEqual(Array.from(matchOrderPayments(order, rows), p => p.id), ["1", "2", "3"]);
  assert.equal(matchOrderPayments({ id: 1, payment: { order_id: "o_38441_77" } }, rows)[0].id, "4");
  assert.equal(matchOrderPayments({ id: 3844 }, rows).length, 0);
});
test("successful partial, duplicate and foreign currency payments do not imply full payment", () => {
  const success = payment("one", "success", 100);
  assert.equal(paymentAmountMismatch([success, success], 100, "UAH"), false);
  assert.equal(paymentAmountMismatch([success], 200, "UAH"), true);
  assert.equal(paymentAmountMismatch([success], 100, "EUR"), true);
  assert.equal(paymentAmountMismatch([payment("bad", "failure")], 200, "UAH"), false);
});

test("known provider failures have Ukrainian explanations while raw data remains intact", () => {
  const insufficient = normalizePayment({ status: "failure", err_description: "Insufficient funds" });
  assert.equal(paymentFailureMessage(insufficient), "Недостатньо коштів на картці");
  assert.equal(insufficient.errorDescription, "Insufficient funds");
  assert.equal(paymentFailureMessage({ errorDescription: "Withdrawal limit already reached.", errorCode: "9863" }), "Досягнуто ліміт списання коштів із картки");
  assert.match(paymentFailureMessage({ errorDescription: null, errorCode: "expired_3ds" }), /Час підтвердження/);
});
test("unknown provider messages do not invent an error reason", () => {
  assert.match(paymentFailureMessage({ errorDescription: "New provider error", errorCode: "new" }), /Оригінальна причина/);
  assert.equal(paymentFailureMessage({ errorDescription: null, errorCode: null }), "Причина не передана LiqPay");
});
