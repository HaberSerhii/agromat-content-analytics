// Round the peak up to a readable tick, then leave one complete tick of headroom.
export function marketingChartScale(peak: number) {
  if (!Number.isFinite(peak) || peak <= 0) return { step: 1, maximum: 1, ticks: [0, 1] };
  const rawStep = Math.max(1, peak / 4);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const maximum = (Math.ceil(peak / step) + 1) * step;
  return { step, maximum, ticks: Array.from({length: Math.round(maximum / step) + 1}, (_, i) => i * step) };
}
