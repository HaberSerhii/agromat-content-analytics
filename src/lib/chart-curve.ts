export type ChartPoint = { x: number; y: number };

/** Shape-preserving cubic interpolation: passes through every observation,
 * without inventing peaks or dipping below adjacent values. Nulls break paths. */
export function chartCurveSegments(points: Array<ChartPoint | null>): Array<{ line: string; first: ChartPoint; last: ChartPoint }> {
  const groups: ChartPoint[][] = [];
  let group: ChartPoint[] = [];
  for (const point of [...points, null]) {
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) group.push(point);
    else if (group.length) { groups.push(group); group = []; }
  }
  return groups.map(points => {
    const slopes = points.slice(1).map((point, index) => (point.y - points[index].y) / (point.x - points[index].x));
    const tangents = points.map((_, index) => {
      if (index === 0) return slopes[0] || 0;
      if (index === points.length - 1) return slopes.at(-1) || 0;
      const before = slopes[index - 1], after = slopes[index];
      if (!Number.isFinite(before) || !Number.isFinite(after) || before * after <= 0) return 0;
      const h0 = points[index].x - points[index - 1].x, h1 = points[index + 1].x - points[index].x;
      const w0 = 2 * h1 + h0, w1 = h1 + 2 * h0;
      return (w0 + w1) / (w0 / before + w1 / after);
    });
    let line = `M${points[0].x},${points[0].y}`;
    for (let index = 1; index < points.length; index++) {
      const before = points[index - 1], point = points[index], dx = (point.x - before.x) / 3;
      line += ` C${before.x + dx},${before.y + dx * tangents[index - 1]} ${point.x - dx},${point.y - dx * tangents[index]} ${point.x},${point.y}`;
    }
    return { line, first: points[0], last: points.at(-1)! };
  });
}
