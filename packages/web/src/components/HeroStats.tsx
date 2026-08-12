import { useEffect, useState } from "react";
import type { OverviewStats, Severity } from "@openvuln/shared";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(media.matches);
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function useCountUp(target: number, duration = 650): number {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (time: number) => {
      const progress = Math.min(1, (time - start) / duration);
      setValue(Math.round(target * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, reduced, target]);
  return value;
}

const SEVERITIES: Array<{
  level: Severity;
  label: string;
  color: string;
  glow: string;
}> = [
  { level: "critical", label: "Critical", color: "#FF6B6B", glow: "rgba(242,79,79,0.16)" },
  { level: "high", label: "High", color: "#F24F4F", glow: "rgba(242,79,79,0.11)" },
  { level: "medium", label: "Medium", color: "#FF8A5C", glow: "rgba(255,115,60,0.12)" },
  { level: "low", label: "Low", color: "#F7C530", glow: "rgba(247,197,48,0.11)" },
];

function AnimatedNumber({ value }: { value: number }) {
  return <>{useCountUp(value).toLocaleString()}</>;
}

export function HeroStats({
  stats,
  loading = false,
  failed = false,
}: {
  stats: OverviewStats | undefined;
  loading?: boolean;
  failed?: boolean;
}) {
  const unavailable = loading || failed || !stats;
  const scannedRepositories = stats
    ? stats.scanned_project_count ?? Math.min(stats.project_count, stats.scan_completed_count)
    : 0;
  const activeScans = stats?.scan_in_progress_count ?? 0;
  const findingTotal = stats?.finding_total ?? 0;
  const counts = stats?.severity_counts ?? { critical: 0, high: 0, medium: 0, low: 0 };

  const metric = (value: number) => unavailable ? "—" : <AnimatedNumber value={value} />;

  return (
    <section aria-labelledby="coverage-title" className="mt-9 grid gap-4 lg:grid-cols-[0.9fr_1.6fr]">
      <div className="rounded-[24px] border border-white/[0.09] bg-white/[0.035] p-5 sm:p-6">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-tertiary">Scan coverage</p>
        <div className="mt-5 grid grid-cols-3 divide-x divide-white/[0.08]">
          <div className="pr-4">
            <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-white sm:text-4xl">
              {metric(scannedRepositories)}
            </p>
            <h2 id="coverage-title" className="mt-2 text-[11px] leading-4 text-ink-tertiary">Repositories scanned</h2>
          </div>
          <div className="px-4">
            <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-white sm:text-4xl">
              {metric(findingTotal)}
            </p>
            <p className="mt-2 text-[11px] leading-4 text-ink-tertiary">Findings discovered</p>
          </div>
          <div className="pl-4">
            <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-running-ink sm:text-4xl">
              {metric(activeScans)}
            </p>
            <p className="mt-2 text-[11px] leading-4 text-ink-tertiary">Scans in progress</p>
          </div>
        </div>
      </div>

      <div className="rounded-[24px] border border-white/[0.09] bg-white/[0.035] p-5 sm:p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-tertiary">Findings by severity</p>
            <p className="mt-1 text-xs text-ink-tertiary">Current public scan results</p>
          </div>
          <p className="font-mono text-[11px] text-ink-secondary">{unavailable ? "—" : findingTotal.toLocaleString()} total</p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {SEVERITIES.map(({ level, label, color, glow }) => (
            <div
              key={level}
              className="relative overflow-hidden rounded-2xl border border-white/[0.07] px-4 py-3.5"
              style={{ background: `linear-gradient(145deg, ${glow}, rgba(255,255,255,0.018) 70%)` }}
            >
              <span className="absolute inset-y-3 left-0 w-0.5 rounded-full" style={{ backgroundColor: color }} />
              <p className="font-display text-2xl font-semibold tabular-nums text-white">
                {metric(counts[level])}
              </p>
              <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-tertiary">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                {label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
