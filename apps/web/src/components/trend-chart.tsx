/**
 * Dependency-free SVG bar trend — server-rendered, token-colored, dark-mode
 * automatic. Native <title> tooltips keep it accessible without JS.
 */

export interface TrendPoint {
  label: string;
  value: number;
  /** Pre-formatted tooltip value (e.g. "₹1,200"); defaults to the raw number. */
  display?: string;
}

const WIDTH = 300;
const HEIGHT = 80;
const GAP = 3;

export function TrendChart({ points, title }: { points: TrendPoint[]; title: string }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const barWidth = (WIDTH - GAP * (points.length - 1)) / Math.max(points.length, 1);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={title}
      className="h-20 w-full"
      preserveAspectRatio="none"
    >
      {points.map((point, i) => {
        const height = Math.max(point.value === 0 ? 2 : 4, (point.value / max) * (HEIGHT - 4));
        const isLast = i === points.length - 1;
        return (
          <rect
            key={point.label}
            x={i * (barWidth + GAP)}
            y={HEIGHT - height}
            width={barWidth}
            height={height}
            rx={2}
            className={
              point.value === 0
                ? "fill-[--border]"
                : isLast
                  ? "fill-[--accent]"
                  : "fill-[--accent] opacity-45"
            }
          >
            <title>{`${point.label}: ${point.display ?? point.value}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
