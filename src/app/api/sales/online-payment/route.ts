import { NextResponse } from "next/server";
import { isDashboardRequest } from "@/lib/dashboard-auth";
import { liqpayRead } from "@/lib/liqpay";
import { normalizePayment } from "@/lib/online-payments";
import { getServerResult } from "@/lib/server-result-cache";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDashboardRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const orderId = params.get("order_id");
  const paymentId = params.get("payment_id");
  if (!orderId || orderId.length > 255 || !paymentId || paymentId.length > 128) return NextResponse.json({ error: "Invalid payment identifier" }, { status: 400 });
  try {
    const result = await getServerResult({
      namespace: "liqpay-status-v1", key: `${process.env.LIQPAY_PUBLIC_KEY}|${orderId}|${paymentId}`,
      ttlMs: 60_000, maxEntries: 256,
      load: async () => normalizePayment(await liqpayRead("status", { order_id: orderId })),
    });
    // A status response for a newer retry must never overwrite an earlier attempt.
    if (result.value.id !== paymentId || result.value.orderId !== orderId) return NextResponse.json({ error: "Статус належить іншій спробі платежу" }, { status: 409 });
    return NextResponse.json({ payment: result.value }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Не вдалося уточнити статус у LiqPay" }, { status: 502 });
  }
}
