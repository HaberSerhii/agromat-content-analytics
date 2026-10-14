import { NextResponse } from "next/server";
import { isDashboardRequest } from "@/lib/dashboard-auth";
import { cartWithProductLinks, loadCartSnapshot } from "@/lib/sales-carts";

export const dynamic = "force-dynamic";
const kyivDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" });
export async function GET(request: Request) {
  if (!isDashboardRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const cartId = params.get("cart_id");
  if ([from, to].some(date => date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)))) || (from && to && from > to)) {
    return NextResponse.json({ error: "Некоректний період" }, { status: 400 });
  }
  if (cartId !== null && (!/^\d+$/.test(cartId) || !Number.isSafeInteger(Number(cartId)))) {
    return NextResponse.json({ error: "Некоректний ID кошика" }, { status: 400 });
  }
  try {
    const snapshot = await loadCartSnapshot(params.get("refresh") === "1");
    if (cartId !== null) {
      const cart = snapshot.data.find(row => row.id === Number(cartId));
      if (!cart) return NextResponse.json({ error: "Кошик не знайдено" }, { status: 404 });
      return NextResponse.json({ data: await cartWithProductLinks(cart) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const data = snapshot.data.filter(cart => {
      const date = kyivDate.format(new Date(cart.created_at));
      return (!from || date >= from) && (!to || date <= to);
    });
    if (data.some(cart => cart.currency !== "UAH")) throw new Error("У вибірці є інша валюта; сумування потребує окремого розрахунку.");
    return NextResponse.json({ data, fetched_at: snapshot.fetched_at }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не вдалося завантажити кошики" }, { status: 502 });
  }
}
