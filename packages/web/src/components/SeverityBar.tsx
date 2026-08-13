import type { Severity, SeverityCounts } from "@openvuln/shared";
import { SEV_ORDER, severityLabel, totalFindings } from "../shared/lib/format";

/** NVD four tiers — Critical uses R4 #C22828. */
const BAR: Record<Severity, string> = {
  critical: "#C22828",
  high: "#F24F4F",
  medium: "#FF733C",
  low: "#F7C530",
};

const DOT: Record<Severity, string> = {
  critical: "bg-[#C22828]",
  high: "bg-[#F24F4F]",
  medium: "bg-sev-medium-bar",
  low: "bg-sev-low-bar",
};

export function SeverityBar({
  counts,
  widthClass = "w-40",
  heightClass = "h-1.5",
  showLegend = true,
  legendClass = "text-[12px]",
}: {
  counts: SeverityCounts;
  widthClass?: string;
  heightClass?: string;
  showLegend?: boolean;
  legendClass?: string;
}) {
  const total = totalFindings(counts);
  const segs = SEV_ORDER.filter((s) => (counts[s] ?? 0) > 0).map((s) => ({
    level: s,
    pct: total === 0 ? 0 : (counts[s] / total) * 100,
    count: counts[s],
  }));

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`flex ${heightClass} ${widthClass} overflow-hidden rounded-full bg-surface-sunken`}
        role="img"
        aria-label={`Severity distribution, ${total} findings`}
      >
        {segs.map((s) => (
          <div
            key={s.level}
            className="h-full"
            style={{ width: `${s.pct}%`, backgroundColor: BAR[s.level] }}
            title={`${severityLabel(s.level)}: ${s.count}`}
          />
        ))}
      </div>
      {showLegend && (
        <div
          className={`flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-ink-secondary ${legendClass}`}
        >
          {SEV_ORDER.map((s) => (
            <span key={s} className="inline-flex items-center gap-1">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT[s]}`} />
              {counts[s] ?? 0} {severityLabel(s)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
