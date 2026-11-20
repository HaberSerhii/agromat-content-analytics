import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {contentSelection} from './public/content-conversion-filters.mjs';
import {inventorySelection} from './public/inventory-demand-filters.mjs';
import {createRemoteOverview} from './overview-remote.mjs';

// Local UI with the same sanitized, public data used by published Studio.
// Credentials, cookies, mutations and private endpoints are never forwarded.
const publicDir = fileURLToPath(new URL("./public/", import.meta.url));
const source = "https://studio.agromat-analytics.co.ua";
const endpoints = new Set(["content", "products", "inventory", "prices", "promotions", "sales", "channels", "users", "site-funnel", "price-index", "traffic-quarter", "overview-history"]);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const assets = new Set((await fs.readdir(publicDir)).filter(name => types[path.extname(name)]));
const cache = new Map(), pending = new Map(), queue = [];
let active = 0;
const overviewSource=process.env.STUDIO_PREVIEW_SSH?createRemoteOverview(process.env.STUDIO_PREVIEW_SSH):null;
process.on('SIGTERM',()=>{overviewSource?.close();server.close(()=>process.exit(0));});

async function readPublic(key) {
  const hit = cache.get(key);
  if (hit?.expires > Date.now()) return hit;
  if (pending.has(key)) return pending.get(key);
  const task = (async () => {
    if (active >= 2) await new Promise(resolve => queue.push(resolve));
    active++;
    try {
      const response = await fetch(source + key, { headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(90000) });
      if (!response.headers.get("content-type")?.includes("application/json")) throw Error("invalid_response");
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > 8 * 1024 * 1024) throw Error("response_too_large");
      const value = { status: response.status, body, expires: Date.now() + 180000 };
      if (response.ok) {
        if (cache.size >= 40) cache.delete(cache.keys().next().value);
        cache.set(key, value);
      }
      return value;
    } finally {
      active--;
      queue.shift()?.();
      pending.delete(key);
    }
  })();
  pending.set(key, task);
  return task;
}

const server = http.createServer(async (req, res) => {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" };
  const json = (status, value) => { res.writeHead(status, { ...headers, "Content-Type": "application/json" }); res.end(req.method === "HEAD" ? undefined : JSON.stringify(value)); };
  if (!["GET", "HEAD"].includes(req.method)) return json(405, { error: "read_only_preview" });
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/api/health") return json(200, { status: "ok", service: "studio-local-preview", source });
  if (url.pathname === "/api/capabilities") return json(200, { available: true, privateOverview: false });
  if (['/api/overview', '/api/catalog-health', '/api/inventory-demand', '/api/content-conversion', '/api/assortment'].includes(url.pathname)) {
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(req.headers.host || '')) return json(403, {available:false});
    if (url.pathname === '/api/content-conversion') {
      try { contentSelection(url.searchParams); }
      catch { return json(400,{available:false,notice:'Оберіть коректний період до 90 завершених днів і перевірте фільтри.'}); }
    }
    if (url.pathname === '/api/inventory-demand') {
      try { inventorySelection(url.searchParams); }
      catch { return json(400,{available:false,notice:'Перевірте період і фільтри. Максимум 90 завершених днів.'}); }
    }
    if(!overviewSource)return json(503,{available:false,notice:'Для зв’язку ERP та GA4 не налаштовано джерело локального перегляду.'});
    try {const value=await overviewSource.read(Object.fromEntries(url.searchParams), url.pathname.slice(5));return json(value.available?200:503,value);}
    catch{return json(400,{available:false,notice:'Некоректний період або поєднання фільтрів.'});}
  }
  try {
    if (url.pathname.startsWith("/api/")) {
      if (!endpoints.has(url.pathname.slice(5))) return json(404, { error: "not_found" });
      if (queue.length >= 24) return json(503, { available: false, notice: "Джерело зайняте. Повторіть спробу." });
      const result = await readPublic(url.pathname + url.search);
      res.writeHead(result.status, { ...headers, "Content-Type": "application/json" });
      return res.end(req.method === "HEAD" ? undefined : result.body);
    }
    const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!assets.has(name)) return json(404, { error: "not_found" });
    const body = await fs.readFile(path.join(publicDir, name));
    res.writeHead(200, { ...headers, "Content-Type": types[path.extname(name)] });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    json(502, { available: false, notice: "Джерело Studio тимчасово недоступне. Повторіть спробу." });
  }
});
server.listen(Number(process.env.STUDIO_PREVIEW_PORT) || 3112, "127.0.0.1", () => console.log("Studio preview: http://127.0.0.1:" + server.address().port));
