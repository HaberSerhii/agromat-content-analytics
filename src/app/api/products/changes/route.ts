import { NextResponse } from "next/server";
import {
  type TimelineGroup,
  TIMELINE_GROUPS,
  readTimeline,
  readTimelineCounts,
  readTimelinePriceSummary,
  readLiteSyncedAt,
} from "@/lib/products-store";

export const dynamic = "force-dynamic";

function parseIntOr(v: string | null, fallback: number): number {
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseDateMs(v: string | null): number | undefined {
  if (!v) return undefined;
  // Accept either epoch ms or YYYY-MM-DD / ISO
  const asNum = Number(v);
  if (Number.isFinite(asNum) && asNum > 10_000_000_000) return asNum;
  const p = Date.parse(v);
  return Number.isFinite(p) ? p : undefined;
}

function parseIntList(v: string | null): number[] {
  if (!v) return [];
  return v
    .split(",")
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

function isGroup(v: string | null): v is TimelineGroup {
  return !!v && (TIMELINE_GROUPS as string[]).includes(v);
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const groupRaw = q.get("group");
  if (!isGroup(groupRaw)) {
    return NextResponse.json(
      { error: `Invalid group. Use one of: ${TIMELINE_GROUPS.join(", ")}` },
      { status: 400 },
    );
  }
  const group: TimelineGroup = groupRaw;
  const since = parseDateMs(q.get("since"));
  const until = parseDateMs(q.get("until"));
  const limit = Math.min(Math.max(parseIntOr(q.get("limit"), 50), 1), 500);
  const offset = Math.max(parseIntOr(q.get("offset"), 0), 0);
  const sortRaw = q.get("sort");
  const sort: "asc" | "desc" = sortRaw === "asc" ? "asc" : "desc";
  const excludeNew = q.get("exclude_new") !== "false"; // default true
  const statusIdsList = parseIntList(q.get("status_ids"));
  const statusIds = statusIdsList.length ? new Set(statusIdsList) : undefined;
  const categoryIdRaw = parseInt(q.get("category_id") || "", 10);
  const categoryId = Number.isFinite(categoryIdRaw) ? categoryIdRaw : null;

  const syncedAt = await readLiteSyncedAt();
  const excludeNewFirstSeenAt = excludeNew ? syncedAt : null;

  const [{ events, total }, counts, priceSummary] = await Promise.all([
    readTimeline({
      group,
      sinceMs: since,
      untilMs: until,
      limit,
      offset,
      sort,
      excludeNewFirstSeenAt,
      statusIds,
      categoryId,
    }),
    readTimelineCounts(excludeNewFirstSeenAt, since, until, statusIds, categoryId),
    group === "prices"
      ? readTimelinePriceSummary({ sinceMs: since, untilMs: until, excludeNewFirstSeenAt, statusIds, categoryId })
      : Promise.resolve(null),
  ]);

  return NextResponse.json(
    { group, events, total, counts, limit, offset, sort, syncedAt, priceSummary, filters: { statusIds: statusIdsList, categoryId } },
    {
      // Sync runs hourly — short edge cache is plenty and keeps dashboard fresh.
      headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=600" },
    },
  );
}
