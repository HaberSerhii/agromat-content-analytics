import test from "node:test";
import assert from "node:assert/strict";
import {
  NOVA_POSHTA_RETURN_STATUS,
  hasConfirmedNovaPoshtaReturn,
  webshopFinalStatus,
} from "../src/lib/sales-webshop-status.ts";

const returnedIds = new Set(["42"]);

function order(history, current = "Відправлення НП", id = 42) {
  return {
    id,
    status: "В обробці",
    fulfillment: {
      current: { name: current },
      history: history.map((name) => ({ name })),
    },
  };
}

test("Nova Poshta shipment with a confirmed S3 return gets the derived return status", () => {
  const value = order(["Підбір товару", "Відправлення НП"]);
  assert.equal(hasConfirmedNovaPoshtaReturn(value, returnedIds), true);
  assert.equal(webshopFinalStatus(value, returnedIds), NOVA_POSHTA_RETURN_STATUS);
});

test("an order received by the customer is not treated as an unclaimed return", () => {
  const value = order(["Відправлення НП", "Отримано"], "Отримано");
  assert.equal(hasConfirmedNovaPoshtaReturn(value, returnedIds), false);
  assert.equal(webshopFinalStatus(value, returnedIds), "Отримано");
});

test("shipment history without a confirmed S3 return keeps the P2 status", () => {
  const value = order(["Відправлення НП"], "Відправлення НП", 43);
  assert.equal(hasConfirmedNovaPoshtaReturn(value, returnedIds), false);
  assert.equal(webshopFinalStatus(value, returnedIds), "Відправлення НП");
});
