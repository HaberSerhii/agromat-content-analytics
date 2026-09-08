import test from "node:test";
import assert from "node:assert/strict";

import { SALES_AUTO_REFRESH_MS } from "../src/lib/sales-refresh.ts";

test("sales dashboard refresh interval is fifteen minutes", () => {
  assert.equal(SALES_AUTO_REFRESH_MS, 15 * 60 * 1000);
});
