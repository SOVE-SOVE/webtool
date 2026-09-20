import { formatWinRate, winRateRing } from "@/lib/winRate";

const SIZE = 64;
const STROKE = 6;
const RADIUS = (SIZE - STROKE) / 2;

/**
 * A small circular progress ring for the win rate: the arc fills to the
 * rate and the whole-percent figure sits inside it. One colour (the same
 * token as the revenue line), a quiet track, and a round-capped arc that
 * starts at 12 o'clock. Beside it: the label and the won/lost counts the
 * rate is made of — or a plain "no closed deals yet" when there are none,
 * where the ring shows an empty track and a dash.
 *
 * `value` is the API's `conversion_rate_pct`, untouched.
 */
export function WinRateRing({ value, won, lost }: { value: number | null; won: number; lost: number }) {
  const { circumference, dash, filled } = winRateRing(value, RADIUS);
  const text = formatWinRate(value);
  const description =
    value === null ? "Win rate: no closed deals yet" : `Win rate ${text}: ${won} won, ${lost} lost`;

  return (
    <div className="flex items-center gap-3">
      <div role="img" aria-label={description} className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" className="block -rotate-90">
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--border)" strokeWidth={STROKE} />
          {filled && (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="var(--pill-info-fg)"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              className="transition-[stroke-dasharray] duration-[var(--duration-base)] ease-standard motion-reduce:transition-none"
            />
          )}
        </svg>
        <span
          aria-hidden="true"
          className={`absolute inset-0 flex items-center justify-center text-sm font-semibold ${value === null ? "text-fg-subtle" : "text-fg"}`}
        >
          {text}
        </span>
      </div>
      <div className="min-w-0 text-sm">
        <p className="text-fg-muted">Win rate</p>
        <p className="text-xs text-fg-subtle">{value === null ? "No closed deals yet" : `${won} won · ${lost} lost`}</p>
      </div>
    </div>
  );
}
