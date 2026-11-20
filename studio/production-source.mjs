import http from 'node:http';
import {loadOverviewSelection, readOverviewCatalog, readOverviewAssortment, loadInventoryDemand, loadContentConversion} from './overview-source-worker.mjs';
import {contentSelection} from './public/content-conversion-filters.mjs';
import {inventorySelection} from './public/inventory-demand-filters.mjs';
import {validateSelection} from './overview-attribution.mjs';

for (const file of ['/opt/agromat-content-analytics/.env', '/opt/agromat-content-analytics/.env.local']) {
  try { process.loadEnvFile(file); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

const server = http.createServer(async (req, res) => {
  const json = (status, value) => {
    res.writeHead(status, {'Content-Type':'application/json'});
    res.end(JSON.stringify(value));
  };
  if (req.method !== 'GET') return json(405, {available:false});
  const url = new URL(req.url, 'http://localhost');
  let read;
  if (url.pathname === '/catalog-health') {
    read = () => readOverviewCatalog(url.searchParams);
  } else if (url.pathname === '/assortment') {
    let selection;
    try { selection = validateSelection(Object.fromEntries(url.searchParams)); }
    catch { return json(400, {available:false}); }
    read = () => readOverviewAssortment(selection);
  } else if (url.pathname === '/content-conversion') {
    try { contentSelection(url.searchParams); } catch { return json(400, {available:false}); }
    read = () => loadContentConversion(url.searchParams);
  } else if (url.pathname === '/inventory-demand') {
    try { inventorySelection(url.searchParams); } catch { return json(400, {available:false}); }
    const controller = new AbortController();
    res.once('close',()=>controller.abort());
    read = () => loadInventoryDemand(url.searchParams,controller.signal);
  } else if (url.pathname === '/overview') {
    let selection;
    try { selection = validateSelection(Object.fromEntries(url.searchParams)); }
    catch { return json(400, {available:false}); }
    read = () => loadOverviewSelection(selection, {includeMargin:true});
  } else {
    return json(404, {available:false});
  }
  const started = Date.now();
  try {
    const value = await read();
    if (!res.destroyed) return json(200,value);
  }
  catch (error) {
    if (res.destroyed) return;
    console.error(JSON.stringify({event:'studio_source_unavailable', route:url.pathname, type:error.name, code:error.code}));
    return json(503, {available:false});
  } finally {
    const elapsedMs = Date.now()-started;
    if (elapsedMs>=15_000) console.warn(JSON.stringify({event:'studio_source_slow',route:url.pathname,elapsedMs}));
  }
});

if (Number(process.env.LISTEN_FDS) !== 1 || Number(process.env.LISTEN_PID) !== process.pid) {
  throw Error('Studio source requires a systemd Unix socket');
}
server.listen({fd:3});
