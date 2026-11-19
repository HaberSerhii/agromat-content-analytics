import {createReadStream} from 'node:fs';
import {createGunzip} from 'node:zlib';

// The catalogue writer stores a root products array. Decode one product at a
// time so the worker never retains an inflated snapshot and its parsed copy.
export async function readSnapshotProducts(file,visit) {
  const input = createReadStream(file);
  const decoded = createGunzip().setEncoding('utf8');
  input.on('error',error=>decoded.destroy(error));
  input.pipe(decoded);
  let prefix = '', pending = '', found = false, done = false;
  let depth = 0, quoted = false, escaped = false;
  try {
    for await (let chunk of decoded) {
      if (done) continue;
      if (!found) {
        chunk = prefix+chunk;
        const marker = /"products"\s*:\s*\[/.exec(chunk);
        if (!marker) { prefix=chunk.slice(-64);continue; }
        chunk=chunk.slice(marker.index+marker[0].length);
        prefix='';
        found=true;
      }
      let start = 0;
      for (let i=0;i<chunk.length;i++) {
        const char = chunk.charCodeAt(i);
        if (!depth) {
          if (char===93) { done=true;break; }
          if (char===123) { depth=1;start=i;continue; }
          if (char===44 || char===32 || char===10 || char===13 || char===9) continue;
          throw Error('invalid_snapshot_product');
        }
        if (quoted) {
          if (escaped) escaped=false;
          else if (char===92) escaped=true;
          else if (char===34) quoted=false;
        } else if (char===34) {
          quoted=true;
        } else if (char===123) {
          depth++;
        } else if (char===125 && --depth===0) {
          visit(JSON.parse(pending+chunk.slice(start,i+1)));
          pending='';
        }
      }
      if (depth) {
        pending+=chunk.slice(start);
        if (pending.length>2_000_000) throw Error('snapshot_product_too_large');
      }
    }
    if (!done) throw Error('incomplete_snapshot_products');
  } finally {
    input.destroy();
  }
}
