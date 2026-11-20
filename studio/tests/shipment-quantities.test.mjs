import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {parseShipmentQuantity, parseShipmentMargin, readShipmentFacts} from '../shipment-quantities.mjs';

test('ERP quantities keep decimals, zero and the reported unit', () => {
  assert.deepEqual(parseShipmentQuantity('33.1200 м2'), {quantity:33.12,unit:'м²'});
  assert.deepEqual(parseShipmentQuantity('0,0000 шт.'), {quantity:0,unit:'шт'});
  assert.deepEqual(parseShipmentQuantity('5.0000 міш'), {quantity:5,unit:'міш'});
  assert.equal(parseShipmentQuantity('7'), null);
  assert.equal(parseShipmentQuantity(''), null);
});

test('S3 shipment facts match cached ERP documents and surviving SKU occurrences exactly', async () => {
  const tile = {code:'100'}, repeatedTile = {code:'100'}, box = {code:'200'};
  const ambiguous = {code:'400'}, duplicate = {code:'300'};
  const rows = [{docsRef:'a',items:[tile,repeatedTile,box]}, {docsRef:'b',items:[ambiguous]}, {docsRef:'c',items:[duplicate]}];
  const csv = '\uFEFFdocs_ref,goods_codes,rows_count,margin,goods_names\r\n' +
    'a,100|service|100|200,"33.1200 м2|1.0000 грн|1,44 м²|2.0000 пак","15,20|99|0|","Товар, ""А""\r\nопис"\r\n' +
    'b,400|400,3.0000 шт|4.0000 шт,20|30,Дубль\r\n' +
    'c,300,2.0000 шт,10,Товар\r\n' +
    'c,300,3.0000 шт,50,Товар\r\n';
  const {quantities, margins} = await readShipmentFacts(Readable.from([csv]), rows);
  assert.deepEqual(quantities.get(tile), {quantity:33.12,unit:'м²'});
  assert.deepEqual(quantities.get(repeatedTile), {quantity:1.44,unit:'м²'});
  assert.deepEqual(quantities.get(box), {quantity:2,unit:'пак'});
  assert.equal(quantities.has(ambiguous), false);
  assert.equal(quantities.has(duplicate), false);
  assert.equal(margins.get(tile), 15.2);
  assert.equal(margins.get(repeatedTile), 0);
  assert.equal(margins.has(box), false);
  assert.equal(margins.has(ambiguous), false);
  assert.equal(margins.has(duplicate), false);
});

test('line margin keeps negative rates and is independent of the quantity field', async () => {
  assert.equal(parseShipmentMargin('-5,25'), -5.25);
  assert.equal(parseShipmentMargin(' | '), null);
  const item = {code:'100'};
  const source = Readable.from(['docs_ref,goods_codes,margin\na,100,-5.25\n']);
  const {quantities, margins} = await readShipmentFacts(source, [{docsRef:'a', items:[item]}]);
  assert.equal(quantities, undefined);
  assert.equal(margins.get(item), -5.25);
});
