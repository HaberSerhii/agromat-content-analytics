import {contentSelection} from './public/content-conversion-filters.mjs';
import {inventorySelection} from './public/inventory-demand-filters.mjs';
import {catalogSelection} from './catalog-health.mjs';
import {readSiteFunnel} from "./site-funnel.mjs";
import {loadRevenueWaterfall} from "./revenue-waterfall.mjs";
import {readPriceIndex} from "./price-index.mjs";
import {readTrafficQuarter} from "./traffic-quarter.mjs";
import { readOverviewHistory } from "./overview-history.mjs";
import { readUsers } from "./bigquery-users.mjs";
import {readProductionSource} from './production-source-client.mjs';
import {validateSelection} from './overview-attribution.mjs';
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  contentSafe,
  dates,
  previousYear,
  buildPath,
  productsSafe,
  pricesSafe,
  promotionsSafe,
  salesSafe,
  channelsSafe,
} from "./data.mjs";
const root = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {}
const revision = process.env.STUDIO_REVISION || "development",
  origin = process.env.STUDIO_UPSTREAM || "http://127.0.0.1:3000",
  host = new URL(origin);
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(host.hostname) ||
  host.protocol !== "http:"
)
  throw new Error("Studio upstream must be loopback HTTP");
const clients = new Map();
const cache = new Map(),
  inflight = new Map();
let active = 0;
const waiters = [];
async function slot() {
  if (active >= 2) await new Promise((r) => waiters.push(r));
  active++;
}
function release() {
  active--;
  waiters.shift()?.();
}
const normalize = {
  users: true,
  content: contentSafe,
  products: productsSafe,
  inventory: productsSafe,
  prices: pricesSafe,
  promotions: promotionsSafe,
  sales: salesSafe,
  channels: channelsSafe,
};
async function upstream(kind, params, range) {
  if (kind === "users") return readUsers(range, params.get("series") === "week");
  let key = kind + ":" + buildPath(kind, params, range),
    hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (inflight.has(key)) return inflight.get(key);
  let task = (async () => {
    await slot();
    try {
      let response = await fetch(origin + buildPath(kind, params, range), {
        headers: {
          "x-agromat-dashboard-auth": process.env.STUDIO_UPSTREAM_AUTH || "",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(65000),
      });
      if (!response.ok) throw new Error("upstream_" + response.status);
      let raw = await response.json();
      let value = {
        available: true,
        ...normalize[kind](raw),
        loadedAt: new Date().toISOString(),
      };
      if (cache.size >= 60) cache.delete(cache.keys().next().value);
      cache.set(key, { value, expires: Date.now() + 180000 });
      return value;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "source_error",
          kind,
          error: error.name,
          status: String(error.message).startsWith("upstream_")
            ? error.message
            : undefined,
        }),
      );
      return {
        available: false,
        notice:
          "Джерело тимчасово недоступне. Дані не підміняються демонстраційними.",
        loadedAt: new Date().toISOString(),
      };
    } finally {
      release();
      inflight.delete(key);
    }
  })();
  inflight.set(key, task);
  return task;
}
const contentTypes = {
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};
const statics = new Map([
  ["/agromat-logo.svg", "agromat-logo.svg"],
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/app.js", "app.js"],
  ["/chart-data.mjs", "chart-data.mjs"],
  ["/api-cache.mjs", "api-cache.mjs"],
  ["/overview-cache.mjs", "overview-cache.mjs"],
  ["/business-overview.mjs", "business-overview.mjs"],
  ["/revenue-drivers.mjs", "revenue-drivers.mjs"],
  ["/overview-filters.mjs", "overview-filters.mjs"],
  ["/category-treemap.mjs", "category-treemap.mjs"],
  ["/site-funnel.mjs", "site-funnel.mjs"],
  ["/inventory-demand.mjs", "inventory-demand.mjs"],
  ["/inventory-demand-filters.mjs", "inventory-demand-filters.mjs"],
  ["/inventory-demand.css", "inventory-demand.css"],
  ["/content-conversion.mjs", "content-conversion.mjs"],
  ["/content-conversion-filters.mjs", "content-conversion-filters.mjs"],
  ["/content-conversion.css", "content-conversion.css"],
  ["/weekly-charts.mjs", "weekly-charts.mjs"],
  ["/chart-periods.mjs", "chart-periods.mjs"],
  ["/business-overview.css", "business-overview.css"],
  ["/base.css", "base.css"],
  ["/theme.css", "theme.css"],
  ["/studio.css", "studio.css"],
]);
async function salesWithSeries(params, range) {
  const result = await upstream("sales", params, range);
  const days = (Date.parse(range.to) - Date.parse(range.from)) / 86400000 + 1;
  if (!result.available || days <= 30 || params.get("chartInterval") === "month") return result;
  const rows = [];
  for (
    let t = Date.parse(range.from);
    t <= Date.parse(range.to);
    t += 30 * 86400000
  ) {
    const part = {
      from: new Date(t).toISOString().slice(0, 10),
      to: new Date(Math.min(Date.parse(range.to), t + 29 * 86400000))
        .toISOString()
        .slice(0, 10),
    };
    const chunk = await upstream("sales", params, part);
    if (!chunk.available)
      return { ...result, byDate: [], seriesUnavailable: true };
    rows.push(...chunk.byDate);
  }
  return { ...result, byDate: rows };
}
export const server = http.createServer(async (req, res) => {
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Cache-Control": "no-store",
  };
  function json(status, body) {
    res.writeHead(status, {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(body));
  }
  try {
    let url = new URL(req.url, "http://localhost");
    if (!["GET", "HEAD"].includes(req.method)) {
      res.setHeader("Allow", "GET, HEAD");
      return json(405, { error: "read_only" });
    }
    if (url.pathname === "/api/health")
      return json(200, {
        status: "ok",
        service: "agromat-studio",
        revision,
        uptime: Math.floor(process.uptime()),
      });
    if (url.pathname === "/robots.txt") {
      res.writeHead(200, { ...headers, "Content-Type": "text/plain" });
      return res.end("User-agent: *\nDisallow: /\n");
    }
    if (url.pathname.startsWith("/api/")) {
      const ip = String(req.headers["x-real-ip"] || req.socket.remoteAddress),
        now = Date.now(),
        rate = clients.get(ip);
      if (rate && now - rate.since < 60000) {
        if (++rate.count > 90) return json(429, { error: "rate_limited" });
      } else {
        if (clients.size > 2000) clients.clear();
        clients.set(ip, { since: now, count: 1 });
      }
      if (waiters.length >= 24) return json(503, { error: "busy" });
      const kind = url.pathname.slice(5);
      if (kind === 'content-conversion') {
        let selection;
        try { selection = contentSelection(url.searchParams); }
        catch { return json(400,{available:false,notice:'Оберіть коректний період до 90 завершених днів і перевірте фільтри.'}); }
        try { return json(200,await readProductionSource(kind,new URLSearchParams(selection))); }
        catch { return json(503,{available:false,notice:'Дані звіту «Контент × Конверсія» тимчасово недоступні.'}); }
      }
      if (kind === 'inventory-demand') {
        let selection;
        try { selection = inventorySelection(url.searchParams); }
        catch { return json(400,{available:false,notice:'Перевірте період і фільтри. Максимум 90 завершених днів.'}); }
        try { return json(200, await readProductionSource(kind,new URLSearchParams(selection))); }
        catch { return json(503, {available:false, notice:'Дані звіту «Наявність × попит» тимчасово недоступні.'}); }
      }
      if (kind === 'catalog-health') {
        try { catalogSelection(url.searchParams); }
        catch { return json(400, {available:false,error:'invalid_filter_or_range'}); }
        try { return json(200, await readProductionSource('catalog-health', url.searchParams)); }
        catch { return json(503, { available:false, notice:'Дані сегментів каталогу тимчасово недоступні.' }); }
      }
      if(kind==='overview') {
        let selection;try{selection=validateSelection(Object.fromEntries(url.searchParams));}catch{return json(400,{available:false,error:'invalid_filter_or_range'});}
        try{return json(200,await readProductionSource('overview', new URLSearchParams(selection)));}catch{return json(503,{available:false,notice:'Джерело зв’язку відвантажень ERP з GA4 тимчасово недоступне.'});}
      }
      if(kind==='site-funnel'){
        const mode=url.searchParams.get('mode')||'week';
        if(!['week','month'].includes(mode))return json(400,{error:'invalid_mode'});
        const result=await readSiteFunnel(mode,origin,process.env.STUDIO_UPSTREAM_AUTH);
        return json(result.available?200:503,result);
      }
      if(kind==='capabilities')return json(200,{available:true,privateOverview:process.env.STUDIO_PRIVATE_PREVIEW==='1'});
      if(kind==='revenue-waterfall'){
        if(process.env.STUDIO_PRIVATE_PREVIEW!=='1')return json(404,{error:'not_found'});
        let range;try{range=dates(url.searchParams);}catch{return json(400,{error:'invalid_filter_or_range'});}
        const mode=url.searchParams.get('mode')||'yoy';if(!['yoy','month'].includes(mode))return json(400,{error:'invalid_mode'});
        const value=await loadRevenueWaterfall(range,mode,upstream);return json(200,value);
      }
      if (kind === "price-index") {
        const value=await readPriceIndex();return json(value.available?200:503,{...value,revision});
      }
      if (kind === "traffic-quarter") {
        const value=await readTrafficQuarter();return json(value.available?200:503,{...value,revision});
      }
      if (kind === "overview-history") {
        const channel = url.searchParams.get("channel") || "all";
        if (!["all", "site", "rozetka", "monomarket"].includes(channel)) return json(400, {error:"invalid_channel"});
        let range;try{range=dates(url.searchParams);}catch{return json(400,{error:'invalid_filter_or_range'});}
        const value = await readOverviewHistory({channel,range});
        return json(value.available ? 200 : 503, {...value,revision});
      }
      if (!normalize[kind]) return json(404, { error: "not_found" });
      let range;
      try {
        range = dates(url.searchParams);
        buildPath(kind, url.searchParams, range);
      } catch {
        return json(400, { error: "invalid_filter_or_range" });
      }
      let current = await (kind === "sales"
          ? salesWithSeries(url.searchParams, range)
          : upstream(kind, url.searchParams, range)),
        body = { ...current, range, revision };
      if (
        ["sales", "channels", "inventory", "promotions", "users"].includes(
          kind,
        ) &&
        url.searchParams.get("yoy") === "1"
      ) {
        let priorRange = previousYear(range);
        if(kind === "users" && current.available && current.dataThrough && current.dataThrough < range.to && current.dataThrough >= range.from) priorRange=previousYear({...range,to:current.dataThrough});
        const priorParams = new URLSearchParams(url.searchParams);
        if (kind === "inventory") priorParams.set("historical", "1");
        body.previous = {
          ...(await (kind === "sales"
            ? salesWithSeries(url.searchParams, priorRange)
            : upstream(kind, priorParams, priorRange))),
          range: priorRange,
        };
      }
      return json(current.available ? 200 : 503, body);
    }
    let asset = statics.get(url.pathname);
    if (!asset) return json(404, { error: "not_found" });
    let body = await fs.readFile(path.join(root, "public", asset));
    res.writeHead(200, {
      ...headers,
      "Content-Type": contentTypes[path.extname(asset)],
      "Cache-Control":
        asset === "index.html" ? "no-store" : "public, max-age=300",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    json(500, { error: "studio_request_failed" });
  }
});
if (process.env.STUDIO_TEST !== "1")
  server.listen(Number(process.env.PORT) || 3107, "127.0.0.1", () =>
    console.log(
      JSON.stringify({
        event: "studio_ready",
        revision,
        port: Number(process.env.PORT) || 3107,
      }),
    ),
  );
