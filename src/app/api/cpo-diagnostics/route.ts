import path from "node:path";
import { NextResponse } from "next/server";
import { isDashboardRequest } from "@/lib/dashboard-auth";
import { buildCpoDiagnostic } from "@/lib/cpo-analytics/engine";
import { currentKyivIdentity } from "@/lib/cpo-analytics/periods";
import { readCpoAvailability, readCpoCube, saveDiagnosticSnapshot, cpoImportProgress } from "@/lib/cpo-analytics/store";
import type { CpoPeriodKind } from "@/lib/cpo-analytics/types";

export const dynamic = "force-dynamic";

type Input = {
  periodKind?: CpoPeriodKind;
  period?: number;
  year?: number;
  action?: "read" | "estimate" | "build";
};

async function missingSnapshot() {
  const importedRows = await cpoImportProgress();
  return NextResponse.json({
    code: "cpo_snapshot_missing",
    error: importedRows === null ? "Знімок даних CPO ще не створено. Звичайне відкриття не запускає BigQuery." : `Підготовка даних: збережено ${importedRows.toLocaleString("uk-UA")} рядків. Після завершення імпорту повторіть діагностику.`,
  }, { status: 409 });
}

export async function GET(request: Request) {
  if (!isDashboardRequest(request)) return NextResponse.json({ error: "Немає доступу" }, { status: 401 });
  try {
    const availability = await readCpoAvailability();
    if (!availability) return missingSnapshot();
    return NextResponse.json(availability, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Не вдалося прочитати доступні періоди CPO" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isDashboardRequest(request)) return NextResponse.json({ error: "Немає доступу" }, { status: 401 });
  try {
    const input = await request.json().catch(() => ({})) as Input;
    if (input.action === "estimate" || input.action === "build") {
      return NextResponse.json({ code: "offline_import_required", error: "Дані оновлюються автоматично у фоновому режимі. Повторне сканування через панель вимкнено." }, { status: 409 });
    }
    const periodKind: CpoPeriodKind = input.periodKind === "month" ? "month" : "week";
    const availability = await readCpoAvailability();
    if (!availability) return missingSnapshot();
    const latest = availability.periods[periodKind][0];
    const selectedPeriod = input.period ?? latest?.number;
    const selectedYear = input.year ?? (input.period === undefined ? latest?.year : currentKyivIdentity().year);
    if (!availability.periods[periodKind].some((range) => range.number === selectedPeriod && range.year === selectedYear)) {
      return NextResponse.json({
        code: "cpo_period_unavailable",
        error: `Обраний період недоступний. Знімок CPO містить дані до ${availability.dataTo}. Оберіть доступний завершений період.`,
      }, { status: 409 });
    }
    // The validated selection is always present, even for an omitted period.
    if (selectedPeriod === undefined || selectedYear === undefined) return missingSnapshot();
    const stored = await readCpoCube({ kind: periodKind, period: selectedPeriod, year: selectedYear });
    if (!stored) return missingSnapshot();
    const result = buildCpoDiagnostic({
      cube: stored.cube,
      cubeCompressedBytes: stored.compressedBytes,
      periodKind,
      selectedPeriod,
      selectedYear,
    });
    const snapshotFile = await saveDiagnosticSnapshot(result, periodKind, selectedPeriod, selectedYear);
    result.storage.diagnosticSnapshotPath = path.relative(process.cwd(), snapshotFile);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не вдалося виконати діагностику CPO";
    const credentialsMissing = /credential|authentication|Could not load/i.test(message);
    return NextResponse.json({
      code: credentialsMissing ? "credentials_missing" : "diagnostic_failed",
      error: credentialsMissing ? "Облікові дані BigQuery не налаштовані на сервері" : message,
    }, { status: credentialsMissing ? 503 : 500 });
  }
}
