"use client";

import { useId } from "react";
import { chartCurveSegments, type ChartPoint } from "@/lib/chart-curve";

/** Paint only: hit targets, tooltips and data selection stay with each chart. */
export function ChartTrendSeries({ points, baseline, color = "#118dff", comparison = false, strokeWidth = 2.5 }: {
  points: Array<ChartPoint | null>; baseline: number; color?: string; comparison?: boolean; strokeWidth?: number;
}) {
  const id = `chart-area-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const segments = chartCurveSegments(points);
  return <g pointerEvents="none" aria-hidden="true">
    {!comparison && <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.17" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>}
    {segments.map(({ line, first, last }, index) => <g key={index}>
      {!comparison && first.x !== last.x && <path d={`${line} L${last.x},${baseline} L${first.x},${baseline} Z`} fill={`url(#${id})`} />}
      <path d={line} fill="none" stroke={comparison ? "#a4adb7" : color} strokeWidth={comparison ? 2 : strokeWidth} strokeDasharray={comparison ? "1 4" : undefined} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </g>)}
  </g>;
}
