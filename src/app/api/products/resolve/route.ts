import { NextRequest, NextResponse } from "next/server";
import { readAllLite } from "@/lib/products-store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = Number(request.nextUrl.searchParams.get("code") || 0);
  const goodsRef = Number(request.nextUrl.searchParams.get("goodsRef") || 0);
  if (!code && !goodsRef) return NextResponse.json({ error: "code або goodsRef обов’язковий" }, { status: 400 });

  const products = await readAllLite();
  const product = products.find((item) => (code > 0 && item.code === code) || (goodsRef > 0 && item.goodsRef === goodsRef));
  if (!product) return NextResponse.json({ error: "Товар не знайдено" }, { status: 404 });

  return NextResponse.json(product, { headers: { "Cache-Control": "private, max-age=300" } });
}
