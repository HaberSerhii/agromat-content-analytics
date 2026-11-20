import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {parseShipmentQuantity, readShipmentQuantities} from '../shipment-quantities.mjs';

test('ERP quantities keep decimals, zero and the reported unit', () => {
  assert.deepEqual(parseShipmentQuantity('33.1200 м2'), {quantity:33.12,unit:'м²'});
  assert.deepEqual(parseShipmentQuantity('0,0000 шт.'), {quantity:0,unit:'шт'});
  assert.deepEqual(parseShipmentQuantity('5.0000 міш'), {quantity:5,unit:'міш'});
  assert.equal(parseShipmentQuantity('7'), null);
  assert.equal(parseShipmentQuantity(''), null);
});

test('S3 quantities match cached ERP documents and surviving SKU occurrences exactly', async () => {
  const tile = {code:'100'}, repeatedTile = {code:'100'}, box = {code:'200'};
  const ambiguous = {code:'400'}, duplicate = {code:'300'};
  const rows = [{docsRef:'a',items:[tile,repeatedTile,box]}, {docsRef:'b',items:[ambiguous]}, {docsRef:'c',items:[duplicate]}];
  const csv = '\uFEFFdocs_ref,goods_codes,rows_count,goods_names\r\n' +
    'a,100|service|100|200,"33.1200 м2|1.0000 грн|1,44 м²|2.0000 пак","Товар, ""А""\r\nопис"\r\n' +
    'b,400|400,3.0000 шт|4.0000 шт,Дубль\r\n' +
    'c,300,2.0000 шт,Товар\r\n' +
    'c,300,3.0000 шт,Товар\r\n';
  const quantities = await readShipmentQuantities(Readable.from([csv]), rows);
  assert.deepEqual(quantities.get(tile), {quantity:33.12,unit:'м²'});
  assert.deepEqual(quantities.get(repeatedTile), {quantity:1.44,unit:'м²'});
  assert.deepEqual(quantities.get(box), {quantity:2,unit:'пак'});
  assert.equal(quantities.has(ambiguous), false);
  assert.equal(quantities.has(duplicate), false);
});
