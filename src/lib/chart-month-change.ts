/** A missing or zero baseline must never produce Infinity or a fabricated percentage. */
export function chartMonthChange(value: number | null | undefined, baseline: number | null | undefined) {
  if (value == null || baseline == null || !Number.isFinite(value) || !Number.isFinite(baseline)) return null;
  if (baseline === 0) return value === 0 ? 0 : null;
  return (value - baseline) / baseline * 100;
}
