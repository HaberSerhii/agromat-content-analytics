import http from 'node:http';
import {loadOverviewSelection, readOverviewCatalog} from './overview-source-worker.mjs';
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
    read = readOverviewCatalog;
  } else if (url.pathname === '/overview') {
    let selection;
    try { selection = validateSelection(Object.fromEntries(url.searchParams)); }
    catch { return json(400, {available:false}); }
    read = () => loadOverviewSelection(selection);
  } else {
    return json(404, {available:false});
  }
  try { return json(200, await read()); }
  catch (error) {
    console.error(JSON.stringify({event:'studio_source_unavailable', route:url.pathname, type:error.name, code:error.code}));
    return json(503, {available:false});
  }
});

if (Number(process.env.LISTEN_FDS) !== 1 || Number(process.env.LISTEN_PID) !== process.pid) {
  throw Error('Studio source requires a systemd Unix socket');
}
server.listen({fd:3});
