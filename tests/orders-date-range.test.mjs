import test from "node:test";
import assert from "node:assert/strict";
import { ordersApiEndDate, orderInDateRange } from "../src/lib/orders-date-range.ts";

test("Orders API upper bound includes the entire selected final day", () => {
  assert.equal(ordersApiEndDate("2026-09-08"), "2026-09-09");
  assert.equal(ordersApiEndDate("2026-12-31"), "2027-01-01");
  assert.equal(ordersApiEndDate("2028-02-29"), "2028-03-01");
  assert.equal(orderInDateRange("2026-09-08T23:59:59+03:00", "2026-09-08", "2026-09-08"), true);
  assert.equal(orderInDateRange("2026-09-09T00:00:00+03:00", "2026-09-08", "2026-09-08"), false);
  assert.equal(orderInDateRange("2026-09-07T21:00:00Z", "2026-09-08", "2026-09-08"), true);
});
