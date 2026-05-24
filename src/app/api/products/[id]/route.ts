import { NextResponse } from "next/server";
import { readFull, writeFull, readAllLite, readFiltersCache, type ProductFull } from "@/lib/products-store";
import { fetchProductById } from "@/lib/products-api";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  // 1) Try Redis cache
  let full = await readFull(id);

  // 2) On miss — fetch fresh from API and combine with our meta from the lite shard
  if (!full) {
    const api = await fetchProductById(id);
    if (!api) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // Pull meta from the lite snapshot if present
    const all = await readAllLite();
    const lite = all.find((p) => p.id === id);

    // Brand-id lookup
    const fc = await readFiltersCache();
    const brandIdByName = new Map<string, number>();
    if (fc) for (const b of fc.filters.brands) brandIdByName.set(b.name.toLowerCase(), b.id);

    full = {
      id: api.id,
      goodsRef: api.goods_ref,
      code: api.code,
      sku: api.sku,
      name: api.name,
      brand: api.brand,
      brandId: brandIdByName.get((api.brand || "").toLowerCase()) ?? null,
      categoryId: api.category.id,
      categoryName: api.category.name,
      categoryPath: api.category.path,
      url: api.url,
      price: api.prices?.actual ?? null,
      priceBase: api.prices?.base ?? null,
      discountPct: api.discount_pct ?? null,
      currency: api.prices?.currency ?? "UAH",
      statusId: api.stock?.status?.id ?? 0,
      statusName: api.stock?.status?.name ?? "",
      stockQty: api.stock?.quantity ?? null,
      imagesCount: api.images?.length ?? 0,
      reviewsCount: api.reviews?.length ?? 0,
      attributesCount: api.attributes?.length ?? 0,
      ratingAvg: api.reviews?.length
        ? Math.round((api.reviews.reduce((s, r) => s + (r.rating || 0), 0) / api.reviews.length) * 10) / 10
        : null,
      deleted: !!api.deleted,
      createdAt: api.created_at,
      updatedAt: api.updated_at,
      firstSeenAt: lite?.firstSeenAt ?? new Date().toISOString(),
      statusChangedAt: lite?.statusChangedAt ?? null,
      statusHistory: lite?.statusHistory ?? [],
      images: (api.images || []).map((i) => ({
        url: i.ext ? `${i.url}.${i.ext}` : i.url,
        main: i.main,
        sort: i.sort,
      })),
      attributes: (api.attributes || []).map((a) => ({
        id: a.attribute_id,
        name: a.attribute_name,
        values: (a.values || []).map((v) => v.name),
      })),
      reviews: (api.reviews || []).map((r) => ({
        rating: r.rating,
        text: r.text,
        author: r.author,
        advantage: r.advantage,
        disadvantage: r.disadvantage,
        date: r.date,
        likes: r.likes,
        dislikes: r.dislikes,
      })),
    } satisfies ProductFull;

    // Best-effort cache write — ignore failures
    writeFull(full).catch(() => {});
  }

  return NextResponse.json(full, {
    // Drill-down records rarely change between syncs — cache aggressively.
    headers: { "Cache-Control": "private, max-age=300, stale-while-revalidate=86400" },
  });
}
