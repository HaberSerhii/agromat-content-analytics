import {createInterface} from 'node:readline';

export function parseShipmentQuantity(value) {
  const match = value.trim().match(/^([+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+))\s+(\p{L}[\p{L}\d²³./ -]{0,31})$/u);
  if (!match) return null;
  const quantity = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(quantity)) return null;
  const reportedUnit = match[2].toLocaleLowerCase('uk').replace(/\.+$/, '');
  const unit = /^(?:м|m)[2²]$/.test(reportedUnit) ? 'м²' : reportedUnit;
  return {quantity, unit};
}

export function parseShipmentMargin(value) {
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/u.test(trimmed)) return null;
  const amount = Number(trimmed.replace(',', '.'));
  return Number.isFinite(amount) ? amount : null;
}

function csvCells(record) {
  const cells = [];
  let cell = '', quoted = false;
  for (let i = 0; i < record.length; i++) {
    const character = record[i];
    if (character === '"') {
      if (quoted && record[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else cell += character;
  }
  if (quoted) return null;
  cells.push(cell);
  return cells;
}

export async function readShipmentFacts(body, rows, {signal} = {}) {
  const byRef = new Map(rows.map(row => [row.docsRef, row.items]));
  const seen = new Set();
  const quantities = new WeakMap(), margins = new WeakMap();
  const lines = createInterface({input: body, crlfDelay: Infinity});
  const stop = () => { lines.close(); body.destroy(); };
  signal?.addEventListener('abort', stop, {once: true});
  let header, refIndex, codesIndex, countsIndex = -1, marginIndex = -1, pending = '';
  try {
    signal?.throwIfAborted();
    for await (const line of lines) {
      signal?.throwIfAborted();
      pending = pending ? `${pending}\n${line}` : line;
      const cells = csvCells(pending);
      if (!cells) continue;
      pending = '';
      if (!header) {
        header = cells;
        header[0] = header[0].replace(/^\uFEFF/, '');
        refIndex = header.indexOf('docs_ref');
        codesIndex = header.indexOf('goods_codes');
        countsIndex = header.indexOf('rows_count');
        marginIndex = header.indexOf('margin');
        if (refIndex < 0 || codesIndex < 0 || (countsIndex < 0 && marginIndex < 0)) break;
        continue;
      }
      const ref = cells[refIndex], items = byRef.get(ref);
      if (!items) continue;
      if (seen.has(ref)) {
        for (const item of items) {
          quantities.delete(item);
          margins.delete(item);
        }
        continue;
      }
      seen.add(ref);
      if (cells.length !== header.length) continue;
      const codes = cells[codesIndex].split('|').map(code => code.trim());
      const counts = cells[countsIndex]?.split('|');
      const rates = cells[marginIndex]?.split('|');
      const alignedCounts = counts?.length === codes.length;
      const alignedRates = rates?.length === codes.length;
      if (!alignedCounts && !alignedRates) continue;

      // The cache has already removed service lines. Surviving SKU occurrences
      // must still match the CSV in order, including repeated SKU lines.
      const itemCodes = items.map(item => item.code.trim());
      const wanted = new Set(itemCodes);
      const positions = codes.flatMap((code, index) => wanted.has(code) ? [index] : []);
      if (positions.length !== items.length || positions.some((position, index) => codes[position] !== itemCodes[index])) continue;
      for (const [index, item] of items.entries()) {
        const position = positions[index];
        if (alignedCounts) {
          const quantity = parseShipmentQuantity(counts[position]);
          if (quantity) quantities.set(item, quantity);
        }
        if (alignedRates) {
          const margin = parseShipmentMargin(rates[position]);
          if (margin !== null) margins.set(item, margin);
        }
      }
    }
    signal?.throwIfAborted();
    if (pending) throw Error('incomplete_shipment_csv');
    return {quantities:countsIndex < 0 ? undefined : quantities, margins:marginIndex < 0 ? undefined : margins};
  } finally {
    signal?.removeEventListener('abort', stop);
    lines.close();
    body.destroy();
  }
}
