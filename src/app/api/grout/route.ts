import { NextResponse } from "next/server";
import { isDashboardRequest } from "@/lib/dashboard-auth";
import { getGroutCatalog } from "@/lib/grout-catalog";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "Local prototype only" }, { status: 404 });
  if (!isDashboardRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const catalog = await getGroutCatalog(new URL(request.url).searchParams.get("refresh") === "1");
    return NextResponse.json({ ...catalog, aiConfigured: Boolean(process.env.GEMINI_API_KEY) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Не вдалося завантажити базу товарів. Спробуйте ще раз." }, { status: 503 }); }
}
