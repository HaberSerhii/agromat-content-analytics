"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PromotionProductMetricRow,
  PromotionProductMetricsResponse,
} from "@/lib/promotion-product-metrics-types";
import type {
  WebFunnelChannel,
  WebFunnelDevice,
} from "@/lib/promotion-web-funnel-types";

const numberFmt = new Intl.NumberFormat("uk-UA");

type RankingKind =
  | "listToProduct"
  | "productToSale"
  | "antiListToProduct"
  | "antiProductToSale";

type RankingConfig = {
  kind: RankingKind;
  title: string;
  color: string;
  rankLabel: "TOP" | "АНТИ TOP";
};

type RankingExportContext = {
  from: string;
  to: string;
  channel: WebFunnelChannel;
  device: WebFunnelDevice;
  includeOutOfStock: boolean;
  total: number;
};

function productMetricsParams(input: {
  url: string;
  from: string;
  to: string;
  channel: WebFunnelChannel;
  device: WebFunnelDevice;
  includeOutOfStock: boolean;
  compact: boolean;
}): URLSearchParams {
  return new URLSearchParams({
    url: input.url,
    from: input.from,
    to: input.to,
    channel: input.channel,
    device: input.device,
    include_out_of_stock: input.includeOutOfStock ? "1" : "0",
    ...(input.compact ? { compact: "1" } : {}),
  });
}

const RANKING_CONFIG: RankingConfig[] = [
  {
    kind: "listToProduct",
    title: "Конверсія Список → Картка",
    color: "#107c10",
    rankLabel: "TOP",
  },
  {
    kind: "antiListToProduct",
    title: "АНТИТОП Список → Картка",
    color: "#c23934",
    rankLabel: "АНТИ TOP",
  },
  {
    kind: "productToSale",
    title: "Картка товару → Продаж",
    color: "#f7630c",
    rankLabel: "TOP",
  },
  {
    kind: "antiProductToSale",
    title: "АНТИТОП Картка товару → Продаж",
    color: "#a4262c",
    rankLabel: "АНТИ TOP",
  },
];

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function rankingSlug(kind: RankingKind): string {
  const slugs: Record<RankingKind, string> = {
    listToProduct: "list-to-product",
    productToSale: "product-to-sale",
    antiListToProduct: "anti-list-to-product",
    antiProductToSale: "anti-product-to-sale",
  };
  return slugs[kind];
}

function rankingColumns(kind: RankingKind): string[] {
  if (kind === "listToProduct" || kind === "antiListToProduct") {
    return ["Конверсія список → картка", "Переходи в картку", "Покази у списку"];
  }
  return ["Конверсія картка → продаж", "Переходи в картку", "Продано, шт."];
}

function rankingValues(kind: RankingKind, row: PromotionProductMetricRow): (number | null)[] {
  if (kind === "listToProduct" || kind === "antiListToProduct") {
    return [
      row.listToProductConversionPct == null ? null : row.listToProductConversionPct / 100,
      row.listClicks,
      row.listImpressions,
    ];
  }
  return [
    row.productToSaleConversionPct == null ? null : row.productToSaleConversionPct / 100,
    row.productViews,
    row.soldQty,
  ];
}

async function downloadRankingXlsx(
  config: RankingConfig,
  rows: PromotionProductMetricRow[],
  context: RankingExportContext,
): Promise<void> {
  const exportRows = rows.slice(0, 250);
  const XLSX = await import("xlsx");
  const headers = [
    "#",
    "IDD / Код товару",
    "goods_ref",
    "Товар",
    "URL",
    "Залишок",
    "Є в наявності",
    ...rankingColumns(config.kind),
  ];
  const values = exportRows.map((row, index) => [
    index + 1,
    row.code,
    row.goodsRef,
    row.name,
    row.url,
    row.stockQty,
    row.inStock ? "Так" : "Ні",
    ...rankingValues(config.kind, row),
  ]);
  const rankingSheet = XLSX.utils.aoa_to_sheet([headers, ...values]);
  rankingSheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${values.length + 1}` };
  rankingSheet["!cols"] = [
    { wch: 6 },
    { wch: 16 },
    { wch: 14 },
    { wch: 58 },
    { wch: 48 },
    { wch: 12 },
    { wch: 14 },
    ...rankingColumns(config.kind).map((label) => ({ wch: Math.max(18, label.length + 2) })),
  ];
  exportRows.forEach((row, index) => {
    const urlCell = rankingSheet[`E${index + 2}`];
    if (urlCell && row.url) urlCell.l = { Target: row.url, Tooltip: "Відкрити товар на сайті" };
  });
  const percentageColumn = XLSX.utils.encode_col(7);
  for (let rowNumber = 2; rowNumber <= values.length + 1; rowNumber += 1) {
    const cell = rankingSheet[`${percentageColumn}${rowNumber}`];
    if (cell && cell.t === "n") cell.z = "0.0%";
  }

  const metadataSheet = XLSX.utils.aoa_to_sheet([
    ["Параметр", "Значення"],
    ["Рейтинг", `${config.rankLabel} · ${config.title}`],
    ["Період від", context.from],
    ["Період до", context.to],
    ["Канал", context.channel],
    ["Пристрій", context.device],
    ["Товари без залишку", context.includeOutOfStock ? "Включено" : "Виключено"],
    ["Вивантажено товарів", exportRows.length],
    ["Усього товарів у рейтингу", context.total],
    ["Створено", new Date().toISOString()],
  ]);
  metadataSheet["!cols"] = [{ wch: 28 }, { wch: 48 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, rankingSheet, config.rankLabel === "TOP" ? "ТОП 250" : "АНТИТОП 250");
  XLSX.utils.book_append_sheet(workbook, metadataSheet, "Параметри");
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer;
  triggerDownload(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${rankingSlug(config.kind)}-${context.from}-${context.to}.xlsx`,
  );
}

function formatQty(value: number): string {
  return Number.isInteger(value) ? numberFmt.format(value) : value.toLocaleString("uk-UA", { maximumFractionDigits: 2 });
}

function metricValue(kind: RankingKind, row: PromotionProductMetricRow) {
  if (kind === "productToSale" || kind === "antiProductToSale") {
    return (
      <div className="text-right">
        <div className="font-black tabular-nums" style={{ color: "#f7630c" }}>
          {row.productToSaleConversionPct == null ? "—" : `${row.productToSaleConversionPct.toFixed(1)}%`}
        </div>
        <div className="mt-0.5 text-[9px] tabular-nums" style={{ color: "var(--text-muted)" }}>
          {numberFmt.format(row.productViews)} переходів · {formatQty(row.soldQty)} шт.
        </div>
      </div>
    );
  }
  if (kind === "listToProduct" || kind === "antiListToProduct") {
    return (
      <div className="text-right">
        <div className="font-black tabular-nums" style={{ color: "#107c10" }}>
          {row.listToProductConversionPct == null ? "—" : `${row.listToProductConversionPct.toFixed(1)}%`}
        </div>
        <div className="mt-0.5 text-[9px] tabular-nums" style={{ color: "var(--text-muted)" }}>
          {numberFmt.format(row.listClicks)} з {numberFmt.format(row.listImpressions)} показів
        </div>
      </div>
    );
  }
  return null;
}

function ProductRanking({
  kind,
  title,
  color,
  rankLabel,
  rows,
  total,
  expanded,
  onToggle,
  copiedCode,
  onCopyCode,
  exporting,
  loadingDetails,
  onExport,
}: {
  kind: RankingKind;
  title: string;
  color: string;
  rankLabel: "TOP" | "АНТИ TOP";
  rows: PromotionProductMetricRow[];
  total: number;
  expanded: boolean;
  onToggle: () => void;
  copiedCode: number | null;
  onCopyCode: (code: number) => void;
  exporting: boolean;
  loadingDetails: boolean;
  onExport: () => void;
}) {
  const visibleRows = rows.slice(0, expanded ? 250 : 20);
  return (
    <section className="overflow-hidden rounded-2xl border" style={{ background: "#fff", borderColor: "var(--border)" }}>
      <div className="border-b px-3 py-3 sm:px-4" style={{ borderColor: "var(--border2)" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.08em] sm:text-xs" style={{ color }}>{title}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onExport}
              disabled={exporting || rows.length === 0}
              className="rounded-lg border px-2 py-1 text-[9px] font-black disabled:cursor-not-allowed disabled:opacity-40"
              style={{ borderColor: `${color}55`, background: "#fff", color }}
              title={`Завантажити ${rankLabel} ${Math.min(250, rows.length)} товарів у Excel`}
            >
              {exporting ? "…" : "↓ EXCEL 250"}
            </button>
            <span className="rounded-lg px-2 py-1 text-[9px] font-black" style={{ background: `${color}12`, color }}>
              {rankLabel} {expanded ? Math.min(250, total) : Math.min(20, total)}
            </span>
          </div>
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <div className="text-xs font-bold" style={{ color: "var(--text-mid)" }}>Немає даних за вибраний період</div>
        </div>
      ) : (
        <div className="divide-y lg:hidden" style={{ borderColor: "var(--border2)" }}>
          {visibleRows.map((row, index) => (
            <article key={row.goodsRef} className="p-3" style={{ borderColor: "var(--border2)" }}>
              <div className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-right text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                  {index + 1}
                </span>
                {row.code != null ? (
                  <button
                    type="button"
                    onClick={() => onCopyCode(row.code as number)}
                    className="rounded border-0 bg-transparent p-0 text-[11px] font-bold tabular-nums hover:underline"
                    style={{ color: copiedCode === row.code ? "#107c10" : "#0078d4" }}
                    title="Скопіювати код товару"
                  >
                    {copiedCode === row.code ? "✓ " : ""}{row.code}
                  </button>
                ) : (
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Без коду</span>
                )}
                <span
                  className="ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                  style={row.inStock
                    ? { background: "#e5f3e5", color: "#107c10" }
                    : { background: "#fde8e8", color: "#a4262c" }}
                >
                  Залишок: {row.stockQty == null ? "—" : numberFmt.format(row.stockQty)}
                </span>
              </div>
              <div className="mt-2 text-xs leading-4">
                {row.url ? (
                  <a href={row.url} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline" style={{ color: "var(--text)" }}>
                    {row.name}
                  </a>
                ) : (
                  <span className="font-semibold" style={{ color: "var(--text-mid)" }}>{row.name}</span>
                )}
              </div>
              <div className="mt-2 flex justify-end rounded-lg px-2 py-1.5" style={{ background: "var(--bg-input)" }}>
                {metricValue(kind, row)}
              </div>
            </article>
          ))}
        </div>
      )}

      {visibleRows.length > 0 && (
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr style={{ background: "var(--bg-input)", color: "var(--text-dim)" }}>
                <th className="w-10 px-2 py-2 text-right font-bold">#</th>
                <th className="px-2 py-2 text-left font-bold">Код</th>
                <th className="min-w-[220px] px-2 py-2 text-left font-bold">Товар</th>
                <th className="px-2 py-2 text-right font-bold">Залишок</th>
                <th className="min-w-[105px] px-3 py-2 text-right font-bold">Результат</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => (
                <tr key={row.goodsRef} className="border-t" style={{ borderColor: "var(--border2)" }}>
                  <td className="px-2 py-2.5 text-right tabular-nums" style={{ color: "var(--text-muted)" }}>{index + 1}</td>
                  <td className="px-2 py-2.5">
                    {row.code != null ? (
                      <button
                        type="button"
                        onClick={() => onCopyCode(row.code as number)}
                        className="rounded border-0 bg-transparent p-0 font-bold tabular-nums hover:underline"
                        style={{ color: copiedCode === row.code ? "#107c10" : "#0078d4" }}
                        title="Скопіювати код товару"
                      >
                        {copiedCode === row.code ? "✓ " : ""}{row.code}
                      </button>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>—</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    {row.url ? (
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold hover:underline"
                        style={{ color: "var(--text)" }}
                      >
                        {row.name}
                      </a>
                    ) : (
                      <div>
                        <div className="font-semibold" style={{ color: "var(--text-mid)" }}>{row.name}</div>
                        <div className="mt-0.5 text-[9px]" style={{ color: "#a4262c" }}>Не знайдено в API каталогу</div>
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <span
                      className="rounded-md px-1.5 py-0.5 font-bold tabular-nums"
                      style={row.inStock
                        ? { background: "#e5f3e5", color: "#107c10" }
                        : { background: "#fde8e8", color: "#a4262c" }}
                    >
                      {row.stockQty == null ? "—" : numberFmt.format(row.stockQty)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">{metricValue(kind, row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 20 && (
        <button
          type="button"
          onClick={onToggle}
          disabled={loadingDetails}
          className="w-full border-0 border-t px-4 py-2.5 text-[10px] font-bold disabled:cursor-wait disabled:opacity-60"
          style={{ borderColor: "var(--border2)", background: "var(--bg-input)", color }}
        >
          {loadingDetails
            ? "Завантажуємо повний рейтинг…"
            : expanded
            ? `Згорнути до ${rankLabel} 20`
            : `Показати ${rankLabel} ${Math.min(250, total)}`}
        </button>
      )}
    </section>
  );
}

export function PromotionProductMetrics({
  url,
  from,
  to,
  channel,
  device,
}: {
  url: string;
  from: string;
  to: string;
  channel: WebFunnelChannel;
  device: WebFunnelDevice;
}) {
  const [includeOutOfStock, setIncludeOutOfStock] = useState(false);
  const [data, setData] = useState<PromotionProductMetricsResponse | null>(null);
  const [detailData, setDetailData] = useState<PromotionProductMetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState<RankingKind | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<RankingKind, boolean>>({
    listToProduct: false,
    productToSale: false,
    antiListToProduct: false,
    antiProductToSale: false,
  });
  const [copiedCode, setCopiedCode] = useState<number | null>(null);
  const [exportingRanking, setExportingRanking] = useState<RankingKind | null>(null);
  const [missingExportState, setMissingExportState] = useState<"idle" | "loading" | "done" | "empty">("idle");
  const detailRequestRef = useRef<{
    key: string;
    promise: Promise<PromotionProductMetricsResponse>;
  } | null>(null);
  const currentRequestKeyRef = useRef("");

  const requestKey = [url, from, to, channel, device, includeOutOfStock ? "1" : "0"].join("|");
  currentRequestKeyRef.current = requestKey;

  useEffect(() => {
    const controller = new AbortController();
    const params = productMetricsParams({
      url,
      from,
      to,
      channel,
      device,
      includeOutOfStock,
      compact: true,
    });
    setLoading(true);
    setError("");
    setDetailData(null);
    setLoadingDetails(null);
    detailRequestRef.current = null;
    setExpanded({
      listToProduct: false,
      productToSale: false,
      antiListToProduct: false,
      antiProductToSale: false,
    });
    fetch(`/api/promotions/product-metrics?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Не вдалося завантажити метрики товарів");
        setData(payload as PromotionProductMetricsResponse);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(reason instanceof Error ? reason.message : "Не вдалося завантажити метрики товарів");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [channel, device, from, includeOutOfStock, to, url]);

  const loadDetailData = useCallback(async (): Promise<PromotionProductMetricsResponse> => {
    if (detailData) return detailData;
    if (detailRequestRef.current?.key === requestKey) return detailRequestRef.current.promise;
    const params = productMetricsParams({
      url,
      from,
      to,
      channel,
      device,
      includeOutOfStock,
      compact: false,
    });
    const promise = fetch(`/api/promotions/product-metrics?${params.toString()}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Не вдалося завантажити повний рейтинг");
        return payload as PromotionProductMetricsResponse;
      });
    detailRequestRef.current = { key: requestKey, promise };
    try {
      const payload = await promise;
      if (currentRequestKeyRef.current === requestKey) setDetailData(payload);
      return payload;
    } finally {
      if (detailRequestRef.current?.promise === promise) detailRequestRef.current = null;
    }
  }, [channel, detailData, device, from, includeOutOfStock, requestKey, to, url]);

  const copyCode = async (code: number) => {
    try {
      await navigator.clipboard.writeText(String(code));
      setCopiedCode(code);
      window.setTimeout(() => setCopiedCode((current) => current === code ? null : current), 1500);
    } catch {
      setCopiedCode(null);
    }
  };

  const exportMissingCodes = async () => {
    if (!data) return;
    setMissingExportState("loading");
    try {
      const source = data.missingProducts.length >= data.tracking.unmatchedGoodsRefs
        ? data
        : await loadDetailData();
      const codes = [...new Set(
        source.missingProducts
        .map((product) => product.code)
        .filter((code): code is number => code != null && code > 0),
      )].sort((left, right) => left - right);
      if (codes.length === 0) {
        setMissingExportState("empty");
        window.setTimeout(() => setMissingExportState("idle"), 1800);
        return;
      }
      const XLSX = await import("xlsx");
      const sheet = XLSX.utils.aoa_to_sheet([["IDD"], ...codes.map((code) => [code])]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "IDD");
      const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
      triggerDownload(
        new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `missing-products-idd-${from}-${to}.xlsx`,
      );
      await navigator.clipboard.writeText(codes.join("\n")).catch(() => undefined);
      setMissingExportState("done");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не вдалося завантажити повні дані");
      setMissingExportState("idle");
      return;
    }
    window.setTimeout(() => setMissingExportState("idle"), 1800);
  };

  const exportRanking = async (config: RankingConfig) => {
    if (!data || exportingRanking) return;
    setExportingRanking(config.kind);
    try {
      const source = data.rankings[config.kind].length >= Math.min(250, data.totals[config.kind])
        ? data
        : await loadDetailData();
      await downloadRankingXlsx(config, source.rankings[config.kind], {
        from: source.from,
        to: source.to,
        channel: source.channel,
        device: source.device,
        includeOutOfStock: source.includeOutOfStock,
        total: source.totals[config.kind],
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не вдалося завантажити повний рейтинг");
    } finally {
      setExportingRanking(null);
    }
  };

  const toggleRanking = async (kind: RankingKind) => {
    if (!data || loadingDetails) return;
    if (expanded[kind]) {
      setExpanded((current) => ({ ...current, [kind]: false }));
      return;
    }
    const rows = detailData?.rankings[kind] ?? data.rankings[kind];
    if (rows.length < Math.min(250, data.totals[kind])) {
      setLoadingDetails(kind);
      try {
        await loadDetailData();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Не вдалося завантажити повний рейтинг");
        return;
      } finally {
        setLoadingDetails(null);
      }
    }
    if (currentRequestKeyRef.current === requestKey) {
      setExpanded((current) => ({ ...current, [kind]: true }));
    }
  };

  return (
    <section className="rounded-2xl border p-3 sm:p-4" style={{ background: "var(--bg-card)", borderColor: "var(--border)", boxShadow: "var(--shadow-sm)" }}>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.12em]" style={{ color: "var(--text-dim)" }}>
            Товарна аналітика за веб-метриками
          </div>
        </div>
        <label className="flex w-full cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 sm:w-auto" style={{ borderColor: "var(--border2)", background: "var(--bg-input)" }}>
          <input
            type="checkbox"
            checked={includeOutOfStock}
            onChange={(event) => setIncludeOutOfStock(event.target.checked)}
            className="h-4 w-4 accent-[#118dff]"
          />
          <span className="text-[10px] font-bold" style={{ color: "var(--text-mid)" }}>
            Показувати також товари без залишку
          </span>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[9px]">
        {data && data.tracking.unmatchedGoodsRefs > 0 && (
          <>
            <span className="rounded-lg px-2 py-1 font-semibold" style={{ background: "#fff4ce", color: "#8a6d00" }}>
              {numberFmt.format(data.tracking.unmatchedGoodsRefs)} товаров, которые присутствуют в анализе, отсутствуют на сайте
            </span>
            <button
              type="button"
              onClick={exportMissingCodes}
              disabled={missingExportState === "loading"}
              className="rounded-lg border px-2.5 py-1 font-bold disabled:opacity-50"
              style={{ borderColor: "#d5b55b", background: "#fff", color: "#7a5b00" }}
            >
              {missingExportState === "loading"
                ? "Выгружаем…"
                : missingExportState === "done"
                  ? "✓ Выгружено"
                  : missingExportState === "empty"
                    ? "Нет IDD"
                    : "Выгрузить IDD"}
            </button>
          </>
        )}
        {loading && <span className="px-2 py-1 font-semibold" style={{ color: "#118dff" }}>Оновлюємо TOP…</span>}
      </div>

      {error && (
        <div className="mt-4 rounded-xl border px-4 py-3 text-xs" style={{ borderColor: "#f4b8b8", background: "#fff4f4", color: "#a4262c" }}>
          {error}
        </div>
      )}

      {!data && loading && !error && (
        <div className="mt-4 rounded-xl border px-5 py-12 text-center text-xs font-bold" style={{ borderColor: "var(--border2)", color: "var(--text-dim)" }}>
          Рахуємо товарні події та звіряємо залишки…
        </div>
      )}

      {data && (
        <>
          <div className={`mt-4 grid gap-4 lg:grid-cols-2 ${loading ? "opacity-60" : ""}`}>
            {RANKING_CONFIG.map((config) => (
              <ProductRanking
                key={config.kind}
                {...config}
                rows={detailData?.rankings[config.kind] ?? data.rankings[config.kind]}
                total={data.totals[config.kind]}
                expanded={expanded[config.kind]}
                onToggle={() => void toggleRanking(config.kind)}
                copiedCode={copiedCode}
                onCopyCode={copyCode}
                exporting={exportingRanking === config.kind}
                loadingDetails={loadingDetails === config.kind}
                onExport={() => exportRanking(config)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
