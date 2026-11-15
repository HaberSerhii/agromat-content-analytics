import { defaultRange } from "./public/chart-data.mjs";
const text = (v) => (typeof v === "string" ? v : "");
const number = (v) =>
  v === null || v === undefined || v === ""
    ? null
    : Number.isFinite(Number(v))
      ? Number(v)
      : null;
const list = (v) => (Array.isArray(v) ? v : []);
const fields = (v, names) =>
  Object.fromEntries(names.map((k) => [k, v?.[k] ?? null]));
export function dates(
  params,
  today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" }),
) {
  const defaults = defaultRange(today);
  const to = params.get("to") || defaults.to,
    from = params.get("from") || defaults.from;
  for (const value of [from, to])
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      new Date(value).toISOString().slice(0, 10) !== value
    )
      throw new Error("invalid_range");
  if (from > to || (Date.parse(to) - Date.parse(from)) / 86400000 >= 365)
    throw new Error("invalid_range");
  return { from, to };
}
export function previousYear(range) {
  const shift = (v) => {
    let [y, m, d] = v.split("-").map(Number);
    return `${y - 1}-${String(m).padStart(2, "0")}-${String(m === 2 && d === 29 ? 28 : d).padStart(2, "0")}`;
  };
  return { from: shift(range.from), to: shift(range.to) };
}
export function productSafe(p) {
  return {
    id: p.id,
    code: p.code,
    goodsRef: p.goodsRef,
    name: text(p.name),
    brand: text(p.brand),
    category: text(p.categoryName || p.category),
    categoryId: p.categoryId,
    price: number(p.price ?? p.ourPrice),
    stock: number(p.stockQty),
    status: text(p.statusName || p.status),
    images: number(p.imagesCount),
    attributes: number(p.attributesCount),
    reviews: number(p.reviewsCount),
    missingAttributes: number(p.missingRequiredAttrsCount),
    url: publicUrl(p.url || p.ourUrl),
  };
}
export function publicUrl(url) {
  try {
    let u = new URL(url);
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}
export function salesSafe(d) {
  const s = d.summary || {};
  return {
    metrics: {
      canceledDocs: number(s.selected?.canceledDocs ?? s.canceledDocs),
      receivedDocs: number(s.orderInsights?.onlineOrders?.totalDocs),
      ...fields(s, [
        "totalDocs",
        "shippedDocs",
        "shippedGoods",
        "shippedRevenue",
        "returnedRevenue",
        "firstShippedDate",
        "lastShippedDate",
      ]),
    },
    plan: fields(s.plan, [
      "month",
      "plan",
      "revenue",
      "completionPct",
      "forecastRevenue",
      "forecastCompletionPct",
    ]),
    byDate: list(s.byDate).map((r) =>
      fields(r, ["date", "docs", "goods", "revenue"]),
    ),
    months: list(s.months).map((r) =>
      fields(r, ["month", "docs", "goods", "revenue"]),
    ),
    brands: list(s.brands).map(bucket),
    categories: list(s.categories).map(bucket),
    segments: list(s.segments).map(bucket),
    states: list(s.states).map((r) => fields(r, ["state", "docs", "revenue"])),
    cancelReasons: list(s.cancelReasons).map((r) =>
      fields(r, ["reason", "docs", "revenue"]),
    ),
    categoryOptions: list(s.categoryOptions).map((r) => text(r.label)),
    brandOptions: list(s.brandOptions).map((r) => text(r.label)),
    updatedAt: d.source?.lastModified || null,
    hasData: Number(s.totalDocs) > 0,
  };
}
function bucket(r) {
  return {
    label: text(r.label),
    docs: number(r.docs),
    goods: number(r.goods),
    revenue: number(r.revenue),
  };
}
export function productsSafe(d) {
  return {
    historyAvailable: Boolean(d.syncedAt),
    items: list(d.items).map(productSafe),
    total: d.total || 0,
    page: d.page || 1,
    pages: d.totalPages || 1,
    categories: list(d.availableCategories).map((r) => ({
      value: String(r.id),
      name: text(r.name),
      count: r.count,
    })),
    brands: list(d.availableBrands).map((r) => ({
      value: String(r.id),
      name: text(r.name),
      count: r.count,
    })),
    stats: fields(d.stats, [
      "totalAll",
      "noImages",
      "noAttributes",
      "noReviews",
      "noSku",
      "newCountRange",
    ]),
    updatedAt: d.syncedAt || null,
  };
}
export function pricesSafe(d) {
  return {
    items: list(d.rows).map((p) => ({
      ...productSafe({ ...p, id: p.productId }),
      competitors: Object.fromEntries(
        Object.entries(p.byCompetitor || {}).map(([id, v]) => [
          id,
          {
            price: number(v.price),
            previousPrice: number(v.previousPrice),
            status: text(v.status),
          },
        ]),
      ),
    })),
    competitors: list(d.competitors).map((r) => ({
      id: r.id,
      name: text(r.name),
    })),
    categories: list(d.categories).map((r) => ({
      value: text(r.value),
      name: text(r.value),
      count: r.count,
    })),
    brands: list(d.brands).map((r) => ({
      value: text(r.value),
      name: text(r.value),
      count: r.count,
    })),
    overview: d.overview
      ? Object.fromEntries(
          [
            "feed",
            "matched",
            "vtmFeed",
            "vtmMatched",
            "agromatLower",
            "agromatHigher",
          ].map((k) => [k, fields(d.overview[k], ["tile", "sanitary"])]),
        )
      : null,
    total: d.total || 0,
    page: d.page || 1,
    pages: Math.max(1, Math.ceil((d.total || 0) / (d.limit || 25))),
    updatedAt: d.currentDate || null,
  };
}
export function promotionsSafe(d) {
  return {
    historyAvailable: d.targetReconstructed === false,
    items: list(d.items).map((r) => ({
      ...productSafe(r),
      id: r.productId,
      category: text(r.categoryName),
      price: number(r.promoPrice),
      basePrice: number(r.basePrice),
      discount: number(r.discountPct),
      program: text(r.promotionName),
      programId: r.promotionIdinc,
      from: r.promotionStartDate,
      to: r.promotionEndDate,
      url: publicUrl(r.productUrl),
    })),
    programs: list(d.promotions).map((r) =>
      fields(r, [
        "idinc",
        "name",
        "type",
        "percent",
        "startDate",
        "endDate",
        "productCount",
        "active",
      ]),
    ),
    categories: list(d.facets?.categories).map(([id, name]) => ({
      value: String(id),
      name,
    })),
    brands: list(d.facets?.brands).map((name) => ({ value: name, name })),
    stats: fields(d.summary, [
      "promotions",
      "products",
      "positions",
      "newPromotions",
      "noPhoto",
      "missingAttributes",
      "notOnSite",
    ]),
    total: d.total || 0,
    page: d.page || 1,
    pages: d.pageCount || 1,
    updatedAt: d.snapshotCapturedAt || d.syncedAt || null,
  };
}
export function channelsSafe(d) {
  const m = new Map();
  for (const r of list(d.rows)) {
    const key = text(r.channel) || "Unassigned",
      v = m.get(key) || { channel: key, sessions: 0, purchases: 0, revenue: 0 };
    for (const k of ["sessions", "purchases", "revenue"])
      v[k] += number(r[k]) || 0;
    m.set(key, v);
  }
  return {
    rows: [...m.values()].sort((a, b) => b.sessions - a.sessions),
    updatedAt: d.fetchedAt || null,
    thresholded: Boolean(d.subjectToThresholding),
    incomplete: Boolean(d.dataLossFromOtherRow),
    notice:
      "GA4: сесії, покупки та атрибутована виручка. Це не відвантаження ERP. Витрати, користувачі та плани каналів у цьому джерелі не передаються.",
  };
}
export function contentSafe(d) {
  const today =
    d.currentDate ||
    new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });
  const previousMonth = new Date(
    Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1),
  )
    .toISOString()
    .slice(0, 7);
  const baseline = [
    ...list(d.overviewPeriod?.current),
    ...list(d.overviewPeriod?.month),
  ]
    .filter(
      (r) =>
        text(r.date).startsWith(previousMonth) &&
        number(r.contentScore) !== null,
    )
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  return {
    previousScore: number(baseline?.contentScore),
    previousDate: baseline?.date || null,
    score: number(d.overviewPeriod?.contentScore),
    updatedAt: d.syncedAt || null,
  };
}
export function buildPath(kind, params, range) {
  if (kind === "content") {
    const today = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Europe/Kyiv",
    });
    const monthStart = new Date(
      Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1),
    )
      .toISOString()
      .slice(0, 10);
    return (
      "/api/products/dashboard-v2?" +
      new URLSearchParams({
        analytics: "0",
        view: "overview",
        limit: "1",
        overviewFrom: monthStart,
        overviewTo: today,
      })
    );
  }
  if (kind === "inventory")
    return (
      "/api/products?" +
      new URLSearchParams({
        limit: "1",
        min_stock: "1",
        ...(params.get("historical") === "1" ? { as_of: range.to } : {}),
      })
    );
  const q = new URLSearchParams();
  q.set(
    "page",
    String(Math.min(1000, Math.max(1, Number(params.get("page")) || 1))),
  );
  q.set("limit", "25");
  for (const k of ["search"]) {
    let v = params.get(k);
    if (v) q.set(k, v.slice(0, 120));
  }
  const cat = params.get("category"),
    brand = params.get("brand");
  if (kind === "products") {
    if (cat && cat !== "all") {
      if (!/^\d+$/.test(cat)) throw new Error("invalid_filter");
      q.set("category_ids", cat);
    }
    if (brand && brand !== "all") {
      if (!/^\d+$/.test(brand)) throw new Error("invalid_filter");
      q.set("brand_ids", brand);
    }
    if (params.get("stock") === "available") q.set("min_stock", "1");
    if (params.get("stock") === "missing") q.set("max_stock", "0");
    if (params.get("quality") === "photos") q.set("has_images", "false");
    if (params.get("quality") === "attributes")
      q.set("has_attributes", "false");
    return "/api/products?" + q;
  }
  if (kind === "prices") {
    q.set("compact", params.get("overview") === "1" ? "0" : "1");
    for (const [k, v] of [
      ["category", cat],
      ["brand", brand],
      ["view", params.get("view")],
      ["competitors", params.get("competitor")],
      ["price", params.get("position")],
    ])
      if (v && v !== "all") q.set(k, v.slice(0, 100));
    return "/api/parser/dashboard-v2?" + q;
  }
  if (kind === "promotions") {
    q.set("from", range.from);
    q.set("to", range.to);
    if (cat && cat !== "all") q.set("category", cat);
    if (brand && brand !== "all") q.set("brand", brand);
    if (params.get("quality") === "photos") q.set("kpi", "no_photo");
    if (params.get("quality") === "attributes")
      q.set("kpi", "missing_attributes");
    return "/api/promotions/catalog?" + q;
  }
  if (kind === "sales") {
    const channel = params.get("channel") || "all";
    if (!["all", "site", "monomarket", "rozetka"].includes(channel))
      throw new Error("unsupported_channel");
    q.set("channel", channel);
    q.delete("page");
    q.delete("limit");
    q.delete("search");
    q.set("compact", "1");
    q.set("from", range.from);
    q.set("to", range.to);
    if (cat && cat !== "all") q.set("sales_category", cat.slice(0, 120));
    if (brand && brand !== "all") q.set("sales_brand", brand.slice(0, 120));
    return "/api/sales?" + q;
  }
  if (kind === "channels")
    return "/api/promotions/ga4-marketing?" + new URLSearchParams(range);
  throw new Error("unknown_source");
}
