// Client for Agromat External API — https://www.agromat.ua/api/v1
// Auth: X-API-Key header. Pagination: per_page=200 max stable (per_page=1 + page=1 returns 500 — server bug).

// ── Raw API types ────────────────────────────────────────────────────────────
export interface ApiCategoryRef {
  id: number;
  name: string;
  path: string;
}
export interface ApiImage {
  id: number;
  url: string;
  ext: string;
  main: boolean;
  sort: number;
}
export interface ApiAttributeValue {
  id: number;
  name: string;
}
export interface ApiAttribute {
  attribute_id: number;
  attribute_name: string;
  values: ApiAttributeValue[];
}
export interface ApiReview {
  id: number;
  author: string;
  rating: number;
  text: string;
  advantage: string | null;
  disadvantage: string | null;
  date: string;
  likes: number;
  dislikes: number;
}
export interface ApiProduct {
  id: number;
  goods_ref: number;
  code: number;
  sku: string | null;
  name: string;
  brand: string;
  category: ApiCategoryRef;
  categories: ApiCategoryRef[];
  url: string;
  prices: { actual: number | null; base: number | null; currency: string };
  discount_pct: number | null;
  stock: { quantity: number | null; status: { id: number; name: string } };
  has_images: boolean;
  images: ApiImage[];
  has_attributes: boolean;
  attributes: ApiAttribute[];
  has_reviews: boolean;
  reviews: ApiReview[];
  deleted: boolean;
  created_at: string;
  updated_at: string;
}
export interface ApiCategoryNode {
  id: number;
  name: string;
  parent_id: number | null;
  active: 0 | 1;
  url: string;
  path: string;
}
export interface ApiStatus {
  id: number;
  name: string;
}
export interface ApiBrand {
  id: number;
  name: string;
  url: string;
}
export interface ApiFilters {
  categories: ApiCategoryNode[];
  statuses: ApiStatus[];
  brands: ApiBrand[];
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
// Resolved lazily per call (rather than at module init) so a missing .env at
// boot doesn't permanently poison the cached value — the next call after env
// is in place will pick it up.
function baseUrl(): string {
  return (process.env.AGROMAT_API_BASE_URL || "https://www.agromat.ua/api/v1").replace(/\/$/, "");
}

function authHeaders(): HeadersInit {
  const key = process.env.AGROMAT_API_KEY || "";
  if (!key) throw new Error("AGROMAT_API_KEY is not configured");
  return { "X-API-Key": key, Accept: "application/json" };
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const url = `${baseUrl()}${path}`;
  // Per-request hard timeout. Without it, an upstream that opens the socket
  // and never replies (we've observed this around page 80 of /products) makes
  // fetch hang indefinitely — retry-wrappers above only catch thrown errors,
  // not hangs, so the whole sync would stall on a single bad page.
  const res = await fetch(url, {
    headers: authHeaders(),
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${path} → HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// Retry wrapper — Agromat API sporadically returns 500 on otherwise-valid requests.
async function getJsonWithRetry<T>(path: string, retries = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await getJson<T>(path);
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt))); // 0.5, 1, 2, 4s
      }
    }
  }
  throw lastErr;
}

// ── Endpoints ────────────────────────────────────────────────────────────────
export async function fetchFilters(): Promise<ApiFilters> {
  return getJsonWithRetry<ApiFilters>("/filters/");
}

export interface ProductsPage {
  data: ApiProduct[];
  meta: { total: number; page: number; per_page: number; total_pages: number };
}

export async function fetchProductsPage(page: number, perPage = 200): Promise<ProductsPage> {
  // NOTE: API returns 500 for `per_page=1&page=1` combo and is sometimes flaky for
  // other pages — retry handled by getJsonWithRetry.
  const q = new URLSearchParams({ per_page: String(perPage), page: String(page) });
  return getJsonWithRetry<ProductsPage>(`/products/?${q.toString()}`);
}

// Streams every page sequentially — caller decides what to do with each batch.
export async function* iterateAllProducts(
  perPage = 200,
  opts: { onProgress?: (page: number, totalPages: number, count: number) => void } = {},
): AsyncGenerator<ApiProduct[]> {
  const first = await fetchProductsPage(1, perPage);
  yield first.data;
  opts.onProgress?.(1, first.meta.total_pages, first.data.length);
  for (let page = 2; page <= first.meta.total_pages; page++) {
    const p = await fetchProductsPage(page, perPage);
    yield p.data;
    opts.onProgress?.(page, first.meta.total_pages, p.data.length);
  }
}

// Single product lookup via numeric `search` (matches id/code/goods_ref).
export async function fetchProductById(id: number): Promise<ApiProduct | null> {
  const q = new URLSearchParams({ per_page: "5", search: String(id) });
  const res = await getJsonWithRetry<ProductsPage>(`/products/?${q.toString()}`);
  return res.data.find((p) => p.id === id) ?? null;
}
