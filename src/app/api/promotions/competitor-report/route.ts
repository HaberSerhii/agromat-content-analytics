import { NextResponse } from "next/server";
import { POST as parserPricesPost } from "@/app/api/parser/prices/route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

interface Competitor {
  id: number;
  name: string;
  adapter_name: string;
}

interface CompetitorCell {
  price: number | null;
  url: string | null;
}

interface PricesRow {
  productId: number;
  code: number | null;
  goodsRef: number | null;
  sku: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  ourPrice: number | null;
  ourUrl: string | null;
  status: string | null;
  byCompetitor: Record<number, CompetitorCell>;
}

interface PricesPayload {
  snapshotDate: string | null;
  competitors: Competitor[];
  rows: PricesRow[];
  notFoundIds: number[];
  error?: string;
}

interface ReportRow extends PricesRow {
  competitorPrices: { competitor: Competitor; price: number; url: string | null }[];
  matchesCount: number;
  violationsCount: number;
  medianPrice: number;
  inMedian: string;
  medianDeviation: number | null;
  minPrice: number;
  minPriceDeviation: number | null;
  minPriceSource: string;
  segment: string;
}

const REPORT_HEADERS = [
  "ID товара", "Код товара", "goods_ref", "Артикул", "Назва", "Категорія",
  "Сегмент", "Бренд", "Статус", "Наша ціна", "Кількість співпадінь",
  "Кількість порушень", "Медіана", "В / не в медіані", "Відхилення від медіани",
  "Мін. ціна", "Відхилення від мін ціни", "Мін. ціна джерело",
] as const;

function cleanCodes(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((item) => Number(item))
    .filter((item) => Number.isSafeInteger(item) && item > 0))];
}

function positivePrice(value: unknown): number | null {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function reportSegment(category: string | null, brand: string | null): string {
  const normalizedBrand = (brand || "").trim();
  if (new Set(["Almera Ceramica", "Ceramica Deseo", "Megagres", "Mozaico De Lux"]).has(normalizedBrand)) {
    return "Плитка ВТМ";
  }
  if (new Set(["Devit", "Primera"]).has(normalizedBrand)) return "Сантехника ВТМ";
  return /плит|керам|кл[іи]нкер|моза/i.test(category || "") ? "Плитка" : "Сантехника";
}

function buildReportRows(payload: PricesPayload): ReportRow[] {
  return payload.rows.flatMap((row) => {
    const ourPrice = positivePrice(row.ourPrice);
    const competitorPrices = payload.competitors.flatMap((competitor) => {
      const cell = row.byCompetitor[competitor.id];
      const price = positivePrice(cell?.price);
      return price == null ? [] : [{ competitor, price, url: cell?.url || null }];
    });
    // This mirrors the competitor-price export: a row is useful only when both
    // our price and at least one quality-checked competitor price are present.
    if (ourPrice == null || competitorPrices.length === 0) return [];

    const prices = competitorPrices.map((item) => item.price);
    const medianPrice = median(prices);
    const minItem = competitorPrices.reduce((best, item) => item.price < best.price ? item : best);
    return [{
      ...row,
      ourPrice,
      competitorPrices,
      matchesCount: prices.length,
      violationsCount: prices.filter((price) => price < ourPrice).length,
      medianPrice,
      inMedian: ourPrice <= medianPrice ? "В медіані" : "Не в медіані",
      medianDeviation: medianPrice > 0 ? (medianPrice - ourPrice) / medianPrice : null,
      minPrice: minItem.price,
      minPriceDeviation: minItem.price > 0 ? (minItem.price - ourPrice) / minItem.price : null,
      minPriceSource: minItem.competitor.name,
      segment: reportSegment(row.category, row.brand),
    }];
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function percent(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("uk-UA", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

async function buildXlsx(payload: PricesPayload, rows: ReportRow[]): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const headers = [...REPORT_HEADERS, ...payload.competitors.map((competitor) => competitor.name)];
  const values = rows.map((row) => {
    const byCompetitor = new Map(row.competitorPrices.map((item) => [item.competitor.id, item]));
    return [
      row.productId,
      row.code ?? "",
      row.goodsRef ?? "",
      row.sku ?? "",
      row.name,
      row.category ?? "",
      row.segment,
      row.brand ?? "",
      row.status ?? "",
      row.ourPrice,
      row.matchesCount,
      row.violationsCount,
      row.medianPrice,
      row.inMedian,
      row.medianDeviation ?? "",
      row.minPrice,
      row.minPriceDeviation ?? "",
      row.minPriceSource,
      ...payload.competitors.map((competitor) => byCompetitor.get(competitor.id)?.price ?? ""),
    ];
  });
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...values]);
  sheet["!cols"] = [10, 12, 12, 18, 54, 28, 18, 18, 18, 12, 18, 18, 12, 16, 18, 12, 18, 20, ...payload.competitors.map(() => 16)]
    .map((wch) => ({ wch }));
  sheet["!autofilter"] = { ref: sheet["!ref"] || `A1:A${rows.length + 1}` };
  (sheet as typeof sheet & { "!freeze"?: { xSplit: number; ySplit: number } })["!freeze"] = { xSplit: 0, ySplit: 1 };

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const excelRow = rowIndex + 2;
    for (const col of [14, 16]) {
      const cell = sheet[XLSX.utils.encode_cell({ r: excelRow - 1, c: col })];
      if (cell) cell.z = "0.0%";
    }
    const ownPriceCell = sheet[XLSX.utils.encode_cell({ r: excelRow - 1, c: 9 })];
    if (ownPriceCell && rows[rowIndex].ourUrl) ownPriceCell.l = { Target: rows[rowIndex].ourUrl as string };
    const byCompetitor = new Map(rows[rowIndex].competitorPrices.map((item) => [item.competitor.id, item]));
    payload.competitors.forEach((competitor, competitorIndex) => {
      const item = byCompetitor.get(competitor.id);
      if (!item?.url) return;
      const cell = sheet[XLSX.utils.encode_cell({ r: excelRow - 1, c: REPORT_HEADERS.length + competitorIndex })];
      if (cell) cell.l = { Target: item.url };
    });
  }

  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: "Ціни конкурентів — акційні товари",
    Subject: `Зіставлення за code, зріз ${payload.snapshotDate || "останній"}`,
    Author: "AGROMAT Content Analytics",
  };
  XLSX.utils.book_append_sheet(workbook, sheet, "Ціни конкурентів");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Uint8Array;
}

function buildPdfHtml(
  payload: PricesPayload,
  rows: ReportRow[],
  requestedCount: number,
  selectionLabel: string,
): string {
  const lowerCount = rows.filter((row) => row.violationsCount > 0).length;
  const competitorHeaders = payload.competitors
    .map((competitor) => `<th class="competitor">${escapeHtml(competitor.name)}</th>`)
    .join("");
  const body = rows.map((row) => {
    const byCompetitor = new Map(row.competitorPrices.map((item) => [item.competitor.id, item]));
    const competitorCells = payload.competitors.map((competitor) => {
      const item = byCompetitor.get(competitor.id);
      if (!item) return "<td class=\"price empty\">—</td>";
      const cheaper = row.ourPrice != null && item.price < row.ourPrice;
      return `<td class="price${cheaper ? " cheaper" : ""}">${money(item.price)}</td>`;
    }).join("");
    return `<tr>
      <td class="code">${escapeHtml(row.code ?? "")}</td>
      <td class="name">${escapeHtml(row.name)}<small>${escapeHtml([row.brand, row.category].filter(Boolean).join(" · "))}</small></td>
      <td>${escapeHtml(row.segment)}</td>
      <td class="price own">${money(row.ourPrice)}</td>
      <td class="number">${row.matchesCount}</td>
      <td class="price">${money(row.medianPrice)}</td>
      <td class="price">${money(row.minPrice)}<small>${escapeHtml(row.minPriceSource)}</small></td>
      <td class="percent ${row.minPriceDeviation != null && row.minPriceDeviation < 0 ? "negative" : "positive"}">${percent(row.minPriceDeviation)}</td>
      ${competitorCells}
    </tr>`;
  }).join("");

  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><style>
    @page { size: A3 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #151729; font-family: Arial, "DejaVu Sans", sans-serif; font-size: 8px; }
    header { border-bottom: 3px solid #118dff; margin-bottom: 6mm; padding-bottom: 4mm; }
    h1 { font-size: 22px; margin: 0 0 2mm; }
    .subtitle { color: #5b6472; font-size: 10px; }
    .meta { display: grid; grid-template-columns: repeat(5, 1fr); gap: 3mm; margin: 0 0 5mm; }
    .metric { background: #f4f8fc; border: 1px solid #d9e7f5; border-radius: 5px; padding: 3mm; }
    .metric b { display: block; color: #118dff; font-size: 17px; margin-bottom: 1mm; }
    .metric span { color: #5b6472; font-size: 8px; text-transform: uppercase; }
    table { border-collapse: collapse; table-layout: fixed; width: 100%; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th { background: #151729; color: white; font-size: 7px; padding: 2mm 1mm; text-align: left; }
    td { border-bottom: 1px solid #dfe5ec; padding: 1.5mm 1mm; vertical-align: top; overflow-wrap: anywhere; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    th:nth-child(1), td.code { width: 5%; }
    th:nth-child(2), td.name { width: 22%; }
    th:nth-child(3) { width: 7%; }
    th:nth-child(4) { width: 6%; }
    th:nth-child(5) { width: 4%; text-align: center; }
    th:nth-child(6) { width: 6%; }
    th:nth-child(7) { width: 8%; }
    th:nth-child(8) { width: 6%; }
    th.competitor { width: auto; }
    small { color: #6b7280; display: block; font-size: 6.5px; line-height: 1.25; margin-top: .7mm; }
    .price, .number, .percent { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
    .number { text-align: center; }
    .own { font-weight: bold; }
    .cheaper { background: #fee2e2; color: #991b1b; font-weight: bold; }
    .empty { color: #a8afb8; }
    .negative { color: #b91c1c; font-weight: bold; }
    .positive { color: #107c10; }
    footer { color: #8a94a3; font-size: 7px; margin-top: 3mm; }
  </style></head><body>
    <header><h1>Ціни конкурентів — акційні товари</h1><div class="subtitle">${escapeHtml(selectionLabel)} · зіставлення строго за code · зріз цін ${escapeHtml(payload.snapshotDate || "останній доступний")}</div></header>
    <section class="meta">
      <div class="metric"><b>${requestedCount}</b><span>Кодів у вибірці</span></div>
      <div class="metric"><b>${rows.length}</b><span>Товарів зі співпадіннями</span></div>
      <div class="metric"><b>${payload.notFoundIds.length}</b><span>Не знайдено за code</span></div>
      <div class="metric"><b>${lowerCount}</b><span>Конкурент дешевше</span></div>
      <div class="metric"><b>${payload.competitors.length}</b><span>Конкурентів у звіті</span></div>
    </section>
    <table><thead><tr>
      <th>Код</th><th>Товар</th><th>Сегмент</th><th>Наша ціна</th><th>Збіги</th><th>Медіана</th><th>Мін. ціна / джерело</th><th>Відхилення</th>${competitorHeaders}
    </tr></thead><tbody>${body}</tbody></table>
    <footer>У звіт включено лише товари з нашою ціною та щонайменше однією валідною ціною конкурента. Червоним позначено ціну конкурента нижче нашої.</footer>
  </body></html>`;
}

async function buildPdf(html: string): Promise<Uint8Array> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({
      format: "A3",
      landscape: true,
      printBackground: true,
      margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
    });
  } finally {
    await browser.close();
  }
}

function responseBody(file: Uint8Array): ArrayBuffer {
  return Uint8Array.from(file).buffer;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const codes = cleanCodes(body?.codes);
  const format = body?.format === "pdf" ? "pdf" : body?.format === "xlsx" ? "xlsx" : null;
  const selectionLabel = typeof body?.selectionLabel === "string" && body.selectionLabel.trim()
    ? body.selectionLabel.trim().slice(0, 200)
    : "Поточна вибірка каталогу акцій";

  if (!format) return NextResponse.json({ error: "Невідомий формат звіту" }, { status: 400 });
  if (codes.length === 0) return NextResponse.json({ error: "У поточній вибірці немає кодів товарів" }, { status: 400 });
  if (codes.length > 10_000) return NextResponse.json({ error: "Забагато кодів товарів (максимум 10 000)" }, { status: 400 });

  const pricesResult = await parserPricesPost(new Request(new URL("/api/parser/prices", request.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: codes, identifierField: "code" }),
  }));
  const payload = await pricesResult.json() as PricesPayload;
  if (!pricesResult.ok) {
    return NextResponse.json({ error: payload.error || "Не вдалося отримати ціни парсера" }, { status: pricesResult.status });
  }

  const rows = buildReportRows(payload);
  if (rows.length === 0) {
    return NextResponse.json({
      error: "Серед відфільтрованих товарів немає позицій із валідною ціною хоча б одного конкурента",
    }, { status: 422 });
  }

  const datePart = payload.snapshotDate || new Date().toISOString().slice(0, 10);
  try {
    if (format === "xlsx") {
      const file = await buildXlsx(payload, rows);
      return new NextResponse(responseBody(file), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="promo-competitor-prices-${datePart}.xlsx"`,
          "Cache-Control": "no-store",
          "x-report-requested": String(codes.length),
          "x-report-matched": String(rows.length),
        },
      });
    }

    const file = await buildPdf(buildPdfHtml(payload, rows, codes.length, selectionLabel));
    return new NextResponse(responseBody(file), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="promo-competitor-prices-${datePart}.pdf"`,
        "Cache-Control": "no-store",
        "x-report-requested": String(codes.length),
        "x-report-matched": String(rows.length),
      },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? `Не вдалося сформувати звіт: ${error.message}` : "Не вдалося сформувати звіт",
    }, { status: 500 });
  }
}
