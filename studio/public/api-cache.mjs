// Only public, sanitized Studio GET responses are stored. No upstream credentials.
const CACHE_NAME = "agromat-studio-api-v1";
const TTL = 180_000;
const MAX_ENTRIES = 40;
const MAX_BYTES = 8 * 1024 * 1024;

export function apiParams(kind, state, extra = {}) {
  const values = { ...state, yoy: state.yoy ? "1" : "0", ...extra };
  if (kind === 'catalog-health') return new URLSearchParams({from:values.from,to:values.to,compareMode:values.compareMode});
  if(kind==='overview')return new URLSearchParams({schema:'linked5',...Object.fromEntries(['from','to','compareMode','salesScope','acquisition','device'].map(key=>[key,values[key]]))});
  if(kind==='site-funnel')return new URLSearchParams({mode:values.mode||'week'});
  if(kind==='capabilities')return new URLSearchParams();
  if(kind==='price-index')return new URLSearchParams({schema:'price1'});
  if(kind==='traffic-quarter')return new URLSearchParams({schema:'traffic1'});
  const keys = ["from", "to"];
  if(kind==='revenue-waterfall')keys.push('mode');
  if (["sales", "channels", "inventory", "promotions", "users"].includes(kind)) keys.push("yoy");
  if (["products", "prices", "promotions"].includes(kind)) keys.push("page", "search", "category", "brand");
  if (kind === "products") keys.push("stock", "quality");
  if (kind === "prices") keys.push("view", "overview", "competitor", "position");
  if (kind === "promotions") keys.push("quality");
  if (kind === "users") keys.push("series");
  if (kind === "overview-history") return new URLSearchParams({schema:"metrics1",from:values.from,to:values.to, ...(values.channel && values.channel !== "all" ? {channel:values.channel} : {})});
  if (kind === "sales") keys.push("channel", "segment", "category", "brand", "chartInterval");
  const params = new URLSearchParams();
  for (const key of keys.sort()) {
    let value = values[key];
    // Days and weeks use the same daily source series, binned locally.
    if (key === "chartInterval" && value !== "month") continue;
    if (value == null || value === "" || value === "all" || value === "Усі" || (key === "page" && Number(value) === 1)) continue;
    params.set(key, String(value));
  }
  return params;
}

export function createApiCache({ fetcher = (...args) => fetch(...args), storage = () => globalThis.caches, now = () => Date.now(), ttl = TTL, maxEntries = MAX_ENTRIES, maxBytes = MAX_BYTES } = {}) {
  const memory = new Map(), pending = new Map();
  let bytes = 0, writes = Promise.resolve();
  function remember(url, entry) {
    if (entry.bytes > maxBytes) return;
    bytes -= memory.get(url)?.bytes || 0;
    memory.delete(url);
    memory.set(url, entry);
    bytes += entry.bytes;
    while (memory.size > maxEntries || bytes > maxBytes) {
      const key = memory.keys().next().value;
      bytes -= memory.get(key).bytes;
      memory.delete(key);
    }
  }
  async function disk() {
    try { return await storage()?.open(CACHE_NAME); } catch { return null; }
  }
  async function read(url) {
    const entry = memory.get(url);
    if (entry && entry.expires > now()) {
      remember(url, entry);
      return entry.value;
    }
    const cache = await disk();
    try {
      const response = await cache?.match(url);
      if (!response) return null;
      const expires = Number(response.headers.get("X-Studio-Expires"));
      const size = Number(response.headers.get("X-Studio-Bytes"));
      if (expires <= now() || !Number.isFinite(expires) || !size || size > maxBytes) {
        await cache.delete(url);
        return null;
      }
      const value = await response.json();
      if (!value.available) return null;
      remember(url, { value, expires, bytes: size });
      return value;
    } catch { return null; }
  }
  async function persist(url, entry, text) {
    const cache = await disk();
    if (!cache) return;
    await cache.delete(url);
    await cache.put(url, new Response(text, { headers: {
      "Content-Type": "application/json", "X-Studio-Expires": String(entry.expires), "X-Studio-Bytes": String(entry.bytes),
    } }));
    const keys = await cache.keys();
    let total = 0, count = 0;
    // Most recently written entries are last in CacheStorage order.
    for (const key of keys.reverse()) {
      const response = await cache.match(key);
      const size = Number(response?.headers.get("X-Studio-Bytes")) || maxBytes;
      if (Number(response?.headers.get("X-Studio-Expires")) <= now() || ++count > maxEntries || total + size > maxBytes) await cache.delete(key);
      else total += size;
    }
  }
  async function load(url) {
    const hit = await read(url);
    if (hit) return hit;
    const response = await fetcher(url);
    const value = await response.json();
    if (!response.ok || !value.available) return {
      available: false, notice: value.notice || "Не вдалося завантажити джерело.",
    };
    if(value.partial)return value;
    const text = JSON.stringify(value);
    const entry = { value, expires: now() + ttl, bytes: new TextEncoder().encode(text).byteLength };
    remember(url, entry);
    if (entry.bytes <= maxBytes) writes = writes.then(() => persist(url, entry, text)).catch(() => undefined);
    return value;
  }
  return {
    get(url) {
      if (pending.has(url)) return pending.get(url);
      const task = load(url).finally(() => pending.delete(url));
      pending.set(url, task);
      return task;
    },
    flush: () => writes,
  };
}
