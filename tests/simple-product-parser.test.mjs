import test from "node:test";
import assert from "node:assert/strict";

import {
  parseLeoceramika,
  parsePlitka,
  parseScopedAvailability,
} from "../scripts/lib/simple-product-parser.mjs";

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

test("Plitka main out-of-stock status overrides stale in-stock JSON-LD", () => {
  const html = `
    <script type="application/ld+json">{
      "@type":"Product", "brand":{"name":"Golden Tile"},
      "offers":{"price":"535.00","availability":"https://schema.org/InStock"}
    }</script>
    <div class="prod-new-right">
      <div class="detail-avail">Немає в наявності</div>
      <span id="textdec_flash"><span>535.00</span> грн</span>
    </div>
    <div class="our-serv-tablet"></div>
  `;

  assert.deepEqual(parsePlitka(html), {
    price: 535,
    status: "Немає в наявності",
    foundBrand: "Golden Tile",
  });
});

test("Plitka reports a missing visible price instead of stale JSON-LD price", () => {
  const html = `
    <script type="application/ld+json">{
      "@type":"Product", "brand":{"name":"Megagres"},
      "offers":{"price":"1173.12","availability":"https://schema.org/InStock"}
    }</script>
    <div class="prod-new-right">
      <div class="detail-avail">В наявності</div>
      <p>Продається через роздрібну мережу</p>
    </div>
    <div class="our-serv-tablet"></div>
  `;

  assert.deepEqual(parsePlitka(html), {
    price: null,
    status: "Ціна відсутня",
    foundBrand: "Megagres",
  });
});

test("Plitka prefers the visible promotional price", () => {
  const html = `
    <script type="application/ld+json">{
      "@type":"Product", "brand":{"name":"Golden Tile"},
      "offers":{"price":"588.50","availability":"https://schema.org/InStock"}
    }</script>
    <div class="prod-new-right">
      <div class="detail-avail">В наявності</div>
      <span id="old-price-product">588.50 грн</span>
      <span id="textdec_flash"><span>528.00</span> грн</span>
    </div>
    <div class="our-serv-tablet"></div>
  `;

  assert.deepEqual(parsePlitka(html), {
    price: 528,
    status: "Є в наявності",
    foundBrand: "Golden Tile",
  });
});
