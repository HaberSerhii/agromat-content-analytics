import test from "node:test";
import assert from "node:assert/strict";

import { parseLeoceramika, parseScopedAvailability } from "../scripts/lib/simple-product-parser.mjs";

test("LeoCeramika uses the main offer availability, not unrelated page text", () => {
  const html = `
    <span id="site_price">450.5</span>
    <link itemprop="availability" href="https://schema.org/InStock" />
    <div>Відсутні зовнішні ознаки використання</div>
  `;

  assert.deepEqual(parseLeoceramika(html), {
    price: 450.5,
    status: "Є в наявності",
    foundBrand: null,
  });
});

test("related out-of-stock cards cannot override the main in-stock offer", () => {
  const html = `
    <meta itemprop="price" content="11021" />
    <link itemprop="availability" href="https://schema.org/InStock" />
    <div data-layer-params="variant:Нет в наличии">Related item</div>
  `;

  assert.equal(parseScopedAvailability(html), "Є в наявності");
});

test("an explicit main OutOfStock status is preserved even without a price", () => {
  const html = `<link itemprop="availability" href="https://schema.org/OutOfStock" />`;

  assert.deepEqual(parseLeoceramika(html), {
    price: null,
    status: "Немає в наявності",
    foundBrand: null,
  });
});
