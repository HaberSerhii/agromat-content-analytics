import fs from "node:fs";
import path from "node:path";
import type { ProductLite } from "./products-store";

export interface InactiveTracking {
  version: 1;
  startedAt: string;
  syncedAt: string;
  month: string;
  previousInactiveIds: number[];
  trackedIds: number[];
  current: ProductLite[];
  baseline: ProductLite[];
  baselineAt: string;
}

function trackingFile() {
  return path.join(process.env.PRODUCT_SNAPSHOTS_DIR || path.join(process.cwd(), "data", "product-snapshots"), "inactive-tracking.json");
}

export function isInactiveProduct(product: ProductLite) {
  return product.deleted || (product.statusId !== 5 && product.statusId !== 3);
}

function kyivMonth(timestamp: string) {
  return new Date(timestamp).toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" }).slice(0, 7);
}

export function readInactiveTracking(): InactiveTracking | null {
  try {
    const value = JSON.parse(fs.readFileSync(trackingFile(), "utf8")) as InactiveTracking;
    if (value.version !== 1 || !Array.isArray(value.trackedIds) || !Array.isArray(value.previousInactiveIds)
      || !Array.isArray(value.current) || !Array.isArray(value.baseline)) throw new Error("Invalid inactive tracking state");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// Initial inactive products are excluded. Only subsequent entries into inactive
// status join the tracked cohort; recoveries leave its current balance.
export function advanceInactiveTracking(previous: InactiveTracking | null, products: ProductLite[], syncedAt: string): InactiveTracking {
  const inactive = products.filter(isInactiveProduct);
  const month = kyivMonth(syncedAt);
  if (!previous) return {
    version: 1, startedAt: syncedAt, syncedAt, month,
    previousInactiveIds: inactive.map((product) => product.id),
    trackedIds: [], current: [], baseline: [], baselineAt: syncedAt,
  };
  if (syncedAt <= previous.syncedAt) return previous;
  const before = new Set(previous.previousInactiveIds);
  const tracked = new Set(previous.trackedIds);
  for (const product of inactive) if (!before.has(product.id)) tracked.add(product.id);
  const rollover = month !== previous.month;
  return {
    ...previous, syncedAt, month,
    previousInactiveIds: inactive.map((product) => product.id),
    trackedIds: [...tracked],
    current: inactive.filter((product) => tracked.has(product.id)),
    baseline: rollover ? previous.current : previous.baseline,
    baselineAt: rollover ? previous.syncedAt : previous.baselineAt,
  };
}

export function updateInactiveTracking(products: ProductLite[], syncedAt: string) {
  const state = advanceInactiveTracking(readInactiveTracking(), products, syncedAt);
  const file = trackingFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state));
  fs.renameSync(temporary, file);
  return state;
}
