/** Fit the visible series, keeping small changes readable and ticks distinct. */
export function productOverviewChartScale(values: number[], integer = false) {
  const finite = values.filter(Number.isFinite);
  const low = finite.length ? Math.min(...finite) : 0;
  const high = finite.length ? Math.max(...finite) : 0;
  const span = high - low;
  const padding = span > 0 ? span * 0.1 : integer ? 1 : 0.02;
  const lower = Math.max(0, low - padding);
  const upper = high + padding;
  const rawStep = (upper - lower) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const nice = [1, 2, 2.5, 5, 10].find(value => value >= normalized) ?? 10;
  const step = integer ? Math.max(1, Math.ceil(nice * magnitude)) : Math.max(Number.EPSILON, nice * magnitude);
  const decimals = Math.max(0, Math.min(12, -Math.floor(Math.log10(step)) + (nice === 2.5 ? 1 : 0)));
  const round = (value: number) => Number(value.toFixed(decimals));
  const minimum = round(Math.floor(lower / step) * step);
  const maximum = round(Math.ceil(upper / step) * step);
  const intervals = Math.max(1, Math.round((maximum - minimum) / step));
  const ticks = Array.from({ length: intervals + 1 }, (_, index) => round(minimum + index * step)).reverse();
  return { minimum, maximum, step, decimals, ticks };
}

export function productOverviewChartY(value: number, minimum: number, maximum: number) {
  return 92 - ((value - minimum) / (maximum - minimum)) * 84;
}
