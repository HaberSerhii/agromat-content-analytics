import { NextResponse } from "next/server";
import { readAllLite, readRequiredAttrs } from "@/lib/products-store";

export const dynamic = "force-dynamic";

interface CategorySummary {
  categoryId: number;
  categoryName: string;
  categoryPath: string;
  total: number;
  withImages: number;
  withAttributes: number;
  withReviews: number;
  withSku: number;
  avgRating: number | null;
  avgImages: number;
  avgReviews: number;
  avgAttributes: number;
  inStock: number;       // statusId === 5
  outOfStock: number;    // statusId === 1
  newLast7d: number;
  statusChangedLast7d: number;
  requiredAttrIds: number[]; // configured for this category
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

export async function GET() {
  const [all, required] = await Promise.all([readAllLite(), readRequiredAttrs()]);
  const cutoff7d = daysAgoIso(7);

  const byCat = new Map<number, CategorySummary>();
  for (const p of all) {
    let row = byCat.get(p.categoryId);
    if (!row) {
      row = {
        categoryId: p.categoryId,
        categoryName: p.categoryName,
        categoryPath: p.categoryPath,
        total: 0,
        withImages: 0,
        withAttributes: 0,
        withReviews: 0,
        withSku: 0,
        avgRating: null,
        avgImages: 0,
        avgReviews: 0,
        avgAttributes: 0,
        inStock: 0,
        outOfStock: 0,
        newLast7d: 0,
        statusChangedLast7d: 0,
        requiredAttrIds: required[String(p.categoryId)] ?? [],
      };
      byCat.set(p.categoryId, row);
    }
    row.total++;
    if (p.imagesCount > 0) row.withImages++;
    if (p.attributesCount > 0) row.withAttributes++;
    if (p.reviewsCount > 0) row.withReviews++;
    if (p.sku && p.sku.trim()) row.withSku++;
    row.avgImages += p.imagesCount;
    row.avgReviews += p.reviewsCount;
    row.avgAttributes += p.attributesCount;
    if (p.statusId === 5) row.inStock++;
    if (p.statusId === 1) row.outOfStock++;
    if (p.firstSeenAt >= cutoff7d) row.newLast7d++;
    if (p.statusChangedAt && p.statusChangedAt >= cutoff7d) row.statusChangedLast7d++;
  }

  // Compute averages + rating
  const ratingsByCat = new Map<number, number[]>();
  for (const p of all) {
    if (p.ratingAvg == null) continue;
    const arr = ratingsByCat.get(p.categoryId) ?? [];
    arr.push(p.ratingAvg);
    ratingsByCat.set(p.categoryId, arr);
  }

  for (const row of byCat.values()) {
    if (row.total > 0) {
      row.avgImages = Math.round((row.avgImages / row.total) * 10) / 10;
      row.avgReviews = Math.round((row.avgReviews / row.total) * 10) / 10;
      row.avgAttributes = Math.round((row.avgAttributes / row.total) * 10) / 10;
    }
    const ratings = ratingsByCat.get(row.categoryId);
    if (ratings?.length) {
      row.avgRating = Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10;
    }
  }

  const rows = [...byCat.values()].sort((a, b) => b.total - a.total);
  return NextResponse.json({ categories: rows, total: all.length });
}
