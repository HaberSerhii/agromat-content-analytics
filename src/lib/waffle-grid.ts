const WAFFLE_COLUMNS = 10;
const WAFFLE_DOTS = 100;

export function waffleActiveDotCount(share: number): number {
  if (!Number.isFinite(share)) return 0;
  return Math.max(0, Math.min(WAFFLE_DOTS, Math.round(share * WAFFLE_DOTS)));
}

export function isWaffleDotActive(index: number, activeCount: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= WAFFLE_DOTS) return false;

  const row = Math.floor(index / WAFFLE_COLUMNS);
  const column = index % WAFFLE_COLUMNS;
  const fillOrder = (WAFFLE_COLUMNS - 1 - row) * WAFFLE_COLUMNS + column;

  return fillOrder < Math.max(0, Math.min(WAFFLE_DOTS, activeCount));
}
