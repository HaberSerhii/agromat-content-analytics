import path from "node:path";
import { NextResponse } from "next/server";
import { isDashboardRequest } from "@/lib/dashboard-auth";
import { buildCpoCube, estimateCpoCubeBytes } from "@/lib/cpo-analytics/bigquery-cube";
import { buildCpoDiagnostic } from "@/lib/cpo-analytics/engine";
import { currentKyivIdentity } from "@/lib/cpo-analytics/periods";
import { readCpoCube, saveDiagnosticSnapshot } from "@/lib/cpo-analytics/store";
import type { CpoPeriodKind } from "@/lib/cpo-analytics/types";

export const dynamic = "force-dynamic";

type Input = {
  periodKind?: CpoPeriodKind;
  period?: number;
  action?: "read" | "estimate" | "build";
};

export async function POST(request: Request) {
  if (!isDashboardRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = await request.json().catch(() => ({})) as Input;
    if (input.action === "estimate") {
      return NextResponse.json({ action: "estimate", estimatedBytesProcessed: await estimateCpoCubeBytes(), executesQuery: false });
    }
    let stored = await readCpoCube();
    if (input.action === "build" && !stored) stored = await buildCpoCube();
    if (!stored) {
      return NextResponse.json({
        code: "cpo_snapshot_missing",
        error: "CPO data snapshot ще не створено. Звичайне відкриття не запускає BigQuery.",
      }, { status: 409 });
    }
    const now = currentKyivIdentity();
    const periodKind: CpoPeriodKind = input.periodKind === "month" ? "month" : "week";
    const defaultPeriod = periodKind === "month" ? Math.max(1, now.month - 1) : Math.max(1, now.week - 1);
    const selectedPeriod = Math.round(Number(input.period || defaultPeriod));
    const result = buildCpoDiagnostic({
      cube: stored.cube,
      cubeCompressedBytes: stored.compressedBytes,
      periodKind,
      selectedPeriod,
      selectedYear: now.year,
    });
    const snapshotFile = await saveDiagnosticSnapshot(result, periodKind, selectedPeriod, now.year);
    result.storage.diagnosticSnapshotPath = path.relative(process.cwd(), snapshotFile);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CPO diagnostic failed";
    const credentialsMissing = /credential|authentication|Could not load/i.test(message);
    return NextResponse.json({
      code: credentialsMissing ? "credentials_missing" : "diagnostic_failed",
      error: credentialsMissing ? "BigQuery credentials не налаштовані на сервері" : message,
    }, { status: credentialsMissing ? 503 : 500 });
  }
}

