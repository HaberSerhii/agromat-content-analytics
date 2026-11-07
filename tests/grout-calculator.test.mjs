import test from "node:test";
import assert from "node:assert/strict";
import { calculateGrout, defaultGroutInputs, parsePackKg, jointRange, rankGroutProducts, safeProductUrl } from "../src/lib/grout-calculator.ts";

test("matches supplied workbook example and rounds to full packs", () => {
  const result = calculateGrout({ length: 1100, width: 300, thickness: 10, depth: 10, joint: 2, area: 40, density: 1.8, waste: 0 }, 2, 250);
  assert.ok(Math.abs(result.totalKg - 6.10909090909) < 1e-9);
  assert.equal(result.packs, 4);
  assert.equal(result.cost, 1000);
  assert.equal(result.purchasedKg, 8);
});
test("uses joint depth, applies reserve before pack rounding, preserves zero price", () => {
  const base = calculateGrout(defaultGroutInputs, 2, 0);
  const half = calculateGrout({ ...defaultGroutInputs, depth: 4 }, 2);
  assert.equal(half.totalKg, base.totalKg / 2);
  assert.ok(Math.abs(base.totalKg - base.baseKg * 1.1) < 1e-10);
  assert.equal(base.cost, 0);
  assert.equal(calculateGrout(defaultGroutInputs).packs, null);
});
test("rejects missing, zero, negative, nonnumeric and geometrically invalid inputs", () => {
  for (const input of [{ ...defaultGroutInputs, length: 0 }, { ...defaultGroutInputs, area: -1 }, { ...defaultGroutInputs, depth: 11 }, { ...defaultGroutInputs, waste: 101 }, { ...defaultGroutInputs, joint: Infinity }, { ...defaultGroutInputs, density: '1.8' }]) assert.throws(() => calculateGrout(input));
  assert.throws(() => calculateGrout({}));
  assert.equal(calculateGrout({ ...defaultGroutInputs, length: 100, width: 100, depth: 10, joint: 2, area: 1, density: 1, waste: 0 }, .4).packs, 1);
});
test("reads only explicit package weights and recognizes decimal comma and grams", () => {
  assert.equal(parsePackKg([{ name: "Пакування", values: ["2,5 кг"] }], "продукт"), 2.5);
  assert.equal(parsePackKg([], "Затирка біла 500г"), .5);
  assert.equal(parsePackKg([], "Затирка 2 кг"), 2);
  assert.equal(parsePackKg([], "Fuga A 100 5 л"), null);
});
test("search uses product attributes and accepts Russian spelling", () => {
  const product = { id: 1, code: 123, name: "Затирка ATIS білий", brand: "ATIS", attributes: [{ name: "Сфера застосування", values: ["басейн"] }, { name: "Ширина шва, мм", values: ["1–12"] }] };
  assert.deepEqual(jointRange(product), [1, 12]);
  assert.equal(rankGroutProducts([product], "для бассейна").length, 1);
  assert.equal(rankGroutProducts([product], "белая ATIS").length, 1);
  assert.equal(rankGroutProducts([product], "невідомий").length, 0);
});
test("only permits links to HTTPS Agromat domains", () => {
  assert.equal(safeProductUrl("javascript:alert(1)"), null);
  assert.equal(safeProductUrl("https://agromat.ua.example.org/p"), null);
  assert.equal(safeProductUrl("https://www.agromat.ua/p"), "https://www.agromat.ua/p");
});
