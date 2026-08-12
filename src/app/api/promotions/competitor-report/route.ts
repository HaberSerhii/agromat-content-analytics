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
  if (new Set(["Devit", "Primera"]).has(normalizedBrand)) return "Сантехніка ВТМ";
  return /плит|керам|кл[іи]нкер|моза/i.test(category || "") ? "Плитка" : "Сантехніка";
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

function signedPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("uk-UA", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value)}`;
}

function deviationFromOur(referencePrice: number, ourPrice: number | null): number | null {
  return ourPrice && ourPrice > 0 ? (referencePrice - ourPrice) / ourPrice : null;
}

function isTile(row: ReportRow): boolean {
  return row.segment.startsWith("Плитка");
}

function isBtm(row: ReportRow): boolean {
  return row.segment.endsWith("ВТМ");
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
  const tileRows = rows.filter(isTile);
  const sanitaryRows = rows.filter((row) => !isTile(row));
  const regularTileRows = tileRows.filter((row) => !isBtm(row));
  const regularSanitaryRows = sanitaryRows.filter((row) => !isBtm(row));
  const btmTileRows = tileRows.filter(isBtm);
  const btmSanitaryRows = sanitaryRows.filter(isBtm);
  const snapshot = payload.snapshotDate || "останній доступний";

  const violationCount = (items: ReportRow[]) => items.filter((row) => row.violationsCount > 0).length;
  const withoutViolations = (items: ReportRow[]) => items.length - violationCount(items);
  const medianStats = (items: ReportRow[]) => {
    const above = items.filter((row) => row.ourPrice != null && row.ourPrice > row.medianPrice);
    const averageAbove = above.length
      ? above.reduce((sum, row) => sum + ((row.ourPrice as number) - row.medianPrice) / row.medianPrice, 0) / above.length
      : 0;
    return {
      total: items.length,
      above: above.length,
      notAbove: items.length - above.length,
      share: items.length ? above.length / items.length : 0,
      averageAbove,
    };
  };
  const tileMedian = medianStats(regularTileRows);
  const sanitaryMedian = medianStats(regularSanitaryRows);
  const btmTileMedian = medianStats(btmTileRows);
  const btmSanitaryMedian = medianStats(btmSanitaryRows);

  const storeRows = payload.competitors.map((competitor) => {
    const matches = rows.flatMap((row) => {
      const item = row.competitorPrices.find((price) => price.competitor.id === competitor.id);
      return item ? [{ row, item }] : [];
    });
    const cheaper = matches.filter(({ row, item }) => row.ourPrice != null && item.price < row.ourPrice);
    const averageDumping = cheaper.length
      ? cheaper.reduce((sum, { row, item }) => sum + ((row.ourPrice as number) - item.price) / (row.ourPrice as number), 0) / cheaper.length
      : 0;
    return {
      competitor,
      matches: matches.length,
      tile: matches.filter(({ row }) => isTile(row)).length,
      sanitary: matches.filter(({ row }) => !isTile(row)).length,
      averageDumping,
    };
  }).sort((a, b) => b.matches - a.matches);

  const dotGrid = (share: number) => {
    const active = Math.max(0, Math.min(100, Math.round(share * 100)));
    return `<div class="dot-grid">${Array.from({ length: 100 }, (_, index) =>
      `<i class="${index >= 100 - active ? "active" : ""}"></i>`).join("")}</div>`;
  };

  const distribution = (items: ReportRow[]) => {
    const buckets = [
      { label: "Без порушень", test: (count: number) => count === 0, color: "#174f70" },
      { label: "1 порушення", test: (count: number) => count === 1, color: "#236e9b" },
      { label: "2 порушення", test: (count: number) => count === 2, color: "#2f88be" },
      { label: "3 порушення", test: (count: number) => count === 3, color: "#3c9ad1" },
      { label: "4 порушення", test: (count: number) => count === 4, color: "#52a7d8" },
      { label: "5+ порушень", test: (count: number) => count >= 5, color: "#70b5df" },
    ].map((bucket) => ({ ...bucket, count: items.filter((row) => bucket.test(row.violationsCount)).length }));
    let cursor = 0;
    const gradient = buckets.filter((bucket) => bucket.count > 0).map((bucket) => {
      const start = cursor;
      cursor += items.length ? (bucket.count / items.length) * 100 : 0;
      return `${bucket.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
    }).join(", ") || "#e5eef5 0% 100%";
    return `<div class="distribution">
      <div class="pie" style="background:conic-gradient(${gradient})"></div>
      <div class="legend">${buckets.filter((bucket) => bucket.count > 0).map((bucket) =>
        `<div><i style="background:${bucket.color}"></i><span>${bucket.label}</span><b>${bucket.count}</b><small>${items.length ? Math.round((bucket.count / items.length) * 100) : 0}%</small></div>`).join("") || "<p>Немає товарів зі співставленнями</p>"}</div>
    </div>`;
  };

  const topTable = (items: ReportRow[]) => {
    const top = items
      .filter((row) => row.violationsCount > 0)
      .sort((a, b) => (deviationFromOur(a.minPrice, a.ourPrice) ?? 0) - (deviationFromOur(b.minPrice, b.ourPrice) ?? 0))
      .slice(0, 22);
    if (!top.length) return `<div class="empty-state">У вибраній акційній вибірці немає цінових порушень для цього сегмента.</div>`;
    return `<table class="top-table"><thead><tr>
      <th class="brand">Бренд</th><th>Модель</th><th class="count">Кількість<br>порушень</th><th class="num">Ціна онлайн<br>AGROMAT</th><th class="num">Відхилення<br>від медіани</th><th class="num">Відхилення<br>від мін. ціни</th><th class="source">Мін. ціна<br>джерело</th>
    </tr></thead><tbody>${top.map((row) => {
      const minItem = row.competitorPrices.find((item) => item.competitor.name === row.minPriceSource && item.price === row.minPrice);
      const productName = row.ourUrl
        ? `<a href="${escapeHtml(row.ourUrl)}">${escapeHtml(row.name)}</a>`
        : escapeHtml(row.name);
      const source = minItem?.url
        ? `<a href="${escapeHtml(minItem.url)}">${escapeHtml(row.minPriceSource)}</a>`
        : escapeHtml(row.minPriceSource);
      return `<tr><td class="brand">${escapeHtml(row.brand || "—")}</td><td class="model">${productName}</td><td class="count">${row.violationsCount} / ${row.matchesCount}</td><td class="num">${money(row.ourPrice)}</td><td class="num">${signedPercent(deviationFromOur(row.medianPrice, row.ourPrice))}</td><td class="num strong">${signedPercent(deviationFromOur(row.minPrice, row.ourPrice))}</td><td class="source">${source}</td></tr>`;
    }).join("")}</tbody></table>`;
  };

  const medianConclusion = (title: string, stats: ReturnType<typeof medianStats>) => stats.above > 0
    ? `<b>${title.toLocaleLowerCase("uk")} <span class="bad">перевищують медіану</span></b><br>у середньому наша ціна <span class="bad">на ${Math.round(stats.averageAbove * 100)}% вища</span>`
    : `<b>${title.toLocaleLowerCase("uk")}: <span class="ok">перевищень медіани немає</span></b>`;
  const medianPanel = (title: string, stats: ReturnType<typeof medianStats>) => `<div class="median-panel">
    <h2>${title}</h2>
    <ul><li>Ціна AGROMAT <span class="ok">не перевищує медіану</span>: <b>${stats.notAbove} SKU</b></li><li>Ціна AGROMAT <span class="bad">перевищує медіану</span>: <b>${stats.above} SKU</b></li></ul>
    ${dotGrid(stats.share)}
    <div class="big-percent">${Math.round(stats.share * 100)}%</div>
    <p>${medianConclusion(title, stats)}</p>
  </div>`;

  const slideFooter = `<footer>${escapeHtml(selectionLabel)} · зріз ${escapeHtml(snapshot)} · зіставлення за code · лише товари поточної акційної вибірки</footer>`;
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><style>
    @page { size: 13.333in 7.5in; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: white; color: #202124; font-family: Arial, "DejaVu Sans", sans-serif; }
    .slide { width: 13.333in; height: 7.5in; padding: 35px 52px 28px; position: relative; break-after: page; overflow: hidden; background: #fff; }
    .slide:last-child { break-after: auto; }
    h1 { margin: 0 0 24px; color: #2c91d1; text-align: center; font-size: 28px; line-height: 1.08; }
    h2 { color: #2c91d1; font-size: 20px; margin: 0 0 16px; }
    footer { position: absolute; left: 52px; right: 52px; bottom: 12px; color: #88929b; font-size: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .hero-metrics { display: grid; grid-template-columns: 1fr 1fr; column-gap: 170px; row-gap: 32px; margin: 28px auto 0; max-width: 850px; text-align: center; }
    .hero-metric.full { grid-column: 1 / -1; }
    .hero-metric b { display: block; color: #171717; font-size: 45px; line-height: 1; margin-bottom: 18px; }
    .hero-metric span { color: #444; font-size: 14px; }
    .segment-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 100px; margin-top: 34px; }
    .segment-summary h2 { margin-bottom: 14px; }
    .segment-summary ul, .median-panel ul { margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.75; }
    .ok { color: #00ad90; } .bad { color: #ff4848; }
    .monitor-table, .top-table { width: 100%; border-collapse: collapse; table-layout: fixed; border: 1px solid #e6e8ea; border-radius: 6px; overflow: hidden; }
    .monitor-table { margin-top: 4px; font-size: 12px; }
    th { color: #4c5157; background: #fff; font-weight: 500; }
    .monitor-table th, .monitor-table td { padding: 8px 14px; text-align: right; }
    .monitor-table th:first-child, .monitor-table td:first-child { text-align: left; }
    tbody tr:nth-child(odd) { background: #f2f2f2; }
    tbody tr:nth-child(even) { background: #fff; }
    .monitor-table a, .top-table a { color: #1996dc; font-weight: 700; text-decoration: underline; }
    .distribution { display: grid; grid-template-columns: 520px 1fr; align-items: center; gap: 90px; max-width: 980px; margin: 25px auto 0; }
    .pie { width: 455px; height: 455px; border-radius: 50%; }
    .legend { display: grid; gap: 17px; font-size: 14px; }
    .legend div { display: grid; grid-template-columns: 16px 1fr 48px 48px; align-items: center; gap: 10px; }
    .legend i { width: 14px; height: 14px; border-radius: 3px; }
    .legend b, .legend small { font-size: 14px; text-align: right; }
    .legend small { color: #68717a; }
    .median-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 80px; margin-top: 18px; }
    .median-panel ul { min-height: 54px; }
    .dot-grid { display: grid; grid-template-columns: repeat(10, 13px); gap: 3px; width: max-content; margin: 22px 0 8px; }
    .dot-grid i { width: 13px; height: 13px; border-radius: 50%; background: #d7eaf5; border: 1px solid #c3dce9; }
    .dot-grid i.active { background: #2c91d1; border-color: #2c91d1; }
    .big-percent { color: #181818; font-size: 34px; font-weight: 800; margin: 4px 0 14px; }
    .median-panel p { font-size: 17px; line-height: 1.35; margin: 0; }
    .top-table { font-size: 10.5px; }
    .top-table th { height: 39px; padding: 5px 8px; font-size: 9px; line-height: 1.15; }
    .top-table td { height: 23px; padding: 4px 8px; vertical-align: middle; overflow: hidden; }
    .top-table .brand { width: 13%; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
    .top-table .model { width: 34%; white-space: nowrap; text-overflow: ellipsis; }
    .top-table .count { width: 10%; text-align: center; }
    .top-table .num { width: 12%; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .top-table .source { width: 12%; text-align: right; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
    .top-table .strong { font-weight: 700; }
    .empty-state { margin: 130px auto; max-width: 650px; padding: 28px; background: #f5f8fa; border: 1px solid #dbe7ef; border-radius: 10px; color: #66717a; text-align: center; font-size: 16px; }
    .note { color: #2c91d1; font-weight: 700; font-size: 15px; margin-top: 20px; }
  </style></head><body>
    <section class="slide"><h1>Вхідні дані</h1>
      <div class="hero-metrics"><div class="hero-metric"><b>${requestedCount}</b><span>Всього SKU в акційній вибірці</span></div><div class="hero-metric"><b>${rows.length}</b><span>Із них зіставлено з конкурентами</span></div><div class="hero-metric full"><b>${payload.competitors.length}</b><span><strong>Конкурентів</strong><br>інтернет-магазини, ціни яких увійшли до звіту</span></div></div>
      <div class="segment-summary"><div><h2>${tileRows.length} SKU плитки:</h2><ul><li class="bad">${violationCount(tileRows)} (${tileRows.length ? Math.round(violationCount(tileRows) / tileRows.length * 100) : 0}%) із порушенням</li><li class="ok">${withoutViolations(tileRows)} (${tileRows.length ? Math.round(withoutViolations(tileRows) / tileRows.length * 100) : 0}%) без порушень</li></ul></div><div><h2>${sanitaryRows.length} SKU сантехніки:</h2><ul><li class="bad">${violationCount(sanitaryRows)} (${sanitaryRows.length ? Math.round(violationCount(sanitaryRows) / sanitaryRows.length * 100) : 0}%) із порушенням</li><li class="ok">${withoutViolations(sanitaryRows)} (${sanitaryRows.length ? Math.round(withoutViolations(sanitaryRows) / sanitaryRows.length * 100) : 0}%) без порушень</li></ul></div></div>${slideFooter}</section>
    <section class="slide"><h1>Магазини у моніторингу</h1><table class="monitor-table"><thead><tr><th>Магазин</th><th>Кількість співпадінь</th><th>Кількість SKU з ціною нижче</th><th>З них плитка</th><th>З них сантехніка</th><th>Середній % демпінгу</th></tr></thead><tbody>${storeRows.map((item) => `<tr><td>${escapeHtml(item.competitor.name)}</td><td>${item.matches}</td><td>${rows.filter((row) => row.competitorPrices.some((price) => price.competitor.id === item.competitor.id && row.ourPrice != null && price.price < row.ourPrice)).length}</td><td>${item.tile}</td><td>${item.sanitary}</td><td>${Math.round(item.averageDumping * 100)}%</td></tr>`).join("")}<tr><td>Усього</td><td>${rows.reduce((sum, row) => sum + row.matchesCount, 0)}</td><td>${rows.reduce((sum, row) => sum + row.violationsCount, 0)}</td><td>${tileRows.reduce((sum, row) => sum + row.matchesCount, 0)}</td><td>${sanitaryRows.reduce((sum, row) => sum + row.matchesCount, 0)}</td><td>—</td></tr></tbody></table>${slideFooter}</section>
    <section class="slide"><h1>Розподіл SKU плитки за кількістю порушень</h1>${distribution(tileRows)}${slideFooter}</section>
    <section class="slide"><h1>Розподіл SKU сантехніки за кількістю порушень</h1>${distribution(sanitaryRows)}${slideFooter}</section>
    <section class="slide"><h1>Аналіз медіанних цін (без ВТМ)</h1><div class="median-grid">${medianPanel("Плитка", tileMedian)}${medianPanel("Сантехніка", sanitaryMedian)}</div><div class="note">Показники сформовано лише за товарами поточної акційної вибірки.</div>${slideFooter}</section>
    <section class="slide"><h1>Топ SKU з порушенням, плитка:</h1>${topTable(regularTileRows)}${slideFooter}</section>
    <section class="slide"><h1>Топ SKU з порушенням, сантехніка:</h1>${topTable(regularSanitaryRows)}${slideFooter}</section>
    <section class="slide"><h1>Аналіз цін ВТМ</h1><div class="median-grid">${medianPanel("Плитка", btmTileMedian)}${medianPanel("Сантехніка", btmSanitaryMedian)}</div><div class="note">Показники сформовано лише за товарами поточної акційної вибірки.</div>${slideFooter}</section>
    <section class="slide"><h1>Топ SKU з порушенням медіанних значень, ВТМ плитка:</h1>${topTable(btmTileRows)}${slideFooter}</section>
    <section class="slide"><h1>Топ SKU з порушенням медіанних значень, ВТМ сантехніка:</h1>${topTable(btmSanitaryRows)}${slideFooter}</section>
  </body></html>`;
}

async function buildPdf(html: string): Promise<Uint8Array> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({
      width: "13.333in",
      height: "7.5in",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
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
        "Content-Disposition": `attachment; filename="price-monitoring-promotions-${datePart}.pdf"`,
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
