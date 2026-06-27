"use client";

import { useId } from "react";

interface SparklineProps {
  data: number[];
  max?: number;
  height?: number;
  className?: string;
  color?: string;
  fill?: boolean;
}

/** Lightweight dependency-free area sparkline. */
export function Sparkline({
  data,
  max,
  height = 48,
  className,
  color = "var(--primary)",
  fill = true,
}: SparklineProps) {
  const id = useId();
  const width = 100;
  const points = data.length > 1 ? data : [0, 0];
  const peak = max ?? Math.max(1, ...points);
  const step = width / (points.length - 1);
  const coords = points.map((v, i) => {
    const x = i * step;
    const y = height - (Math.min(v, peak) / peak) * height;
    return [x, y] as const;
  });
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ width: "100%", height }}
    >
      <defs>
        <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#grad-${id})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
