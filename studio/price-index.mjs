const labels = ["<90", "90–95", "95–100", "100–105", "105–110", ">110"];
export function priceIndexDistribution(rows, snapshotDate = null) {
  const buckets = labels.map((label, index) => ({
    label,
    count: 0,
    risk: index >= 4,
  }));
  let skipped = 0;
  const seen = new Set();
  for (const row of rows) {
    const id = row.productId ?? row.id;
    if (id != null && seen.has(id)) continue;
    if (id != null) seen.add(id);
    const own = Number(row.ourPrice ?? row.price),
      prices = Object.values(row.byCompetitor ?? row.competitors ?? {})
        .map((cell) => cell?.price)
        .filter(
          (price) =>
            typeof price === "number" && Number.isFinite(price) && price > 0,
        )
        .sort((a, b) => a - b);
    if (
      row.isActive === false ||
      !(own > 0) ||
      !Number.isFinite(own) ||
      !prices.length
    ) {
      skipped++;
      continue;
    }
    const mid = Math.floor(prices.length / 2),
      median =
        prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
    const index = Number(((own / median) * 100).toFixed(8));
    const bin =
      index < 90
        ? 0
        : index < 95
          ? 1
          : index < 100
            ? 2
            : index < 105
              ? 3
              : index <= 110
                ? 4
                : 5;
    buckets[bin].count++;
  }
  return {
    available: true,
    buckets,
    total: buckets.reduce((sum, bin) => sum + bin.count, 0),
    skipped,
    snapshotDate,
    definition: "Наша ціна / медіанна підтверджена ціна конкурентів × 100",
    updatedAt: new Date().toISOString(),
  };
}
let saved, pending;
export async function readPriceIndex(
  origin = process.env.STUDIO_UPSTREAM || "http://127.0.0.1:3000",
) {
  if (saved && Date.now() - Date.parse(saved.updatedAt) < 20 * 60000)
    return saved;
  if (pending) return pending;
  const host = new URL(origin);
  if (
    host.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(host.hostname)
  )
    throw Error("invalid_upstream");
  pending = (async () => {
    const rows = [];
    let total = null,
      snapshotDate = null;
    for (let page = 1; page <= 200; page++) {
      const response = await fetch(
        origin +
          "/api/parser/dashboard-v2?" +
          new URLSearchParams({
            page: String(page),
            limit: "100",
            compact: "1",
          }),
        {
          headers: {
            "x-agromat-dashboard-auth": process.env.STUDIO_UPSTREAM_AUTH || "",
          },
          signal: AbortSignal.timeout(65000),
        },
      );
      if (!response.ok) throw Error("price_source_unavailable");
      const data = await response.json();
      if (total === null) {
        total = data.total;
        snapshotDate = data.currentDate;
      }
      if (data.total !== total || data.currentDate !== snapshotDate)
        throw Error("price_source_changed");
      rows.push(...data.rows);
      if (rows.length >= total) break;
      if (!data.rows.length) throw Error("price_source_incomplete");
    }
    if (rows.length !== total) throw Error("price_source_incomplete");
    return (saved = priceIndexDistribution(rows, snapshotDate));
  })()
    .catch(() => ({
      available: false,
      notice: "Повний ціновий зріз тимчасово недоступний.",
    }))
    .finally(() => (pending = null));
  return pending;
}
