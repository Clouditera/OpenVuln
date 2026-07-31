import { useEffect, useState } from "react";
import type { OverviewStats } from "@openvuln/shared";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const fn = () => setReduced(mq.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return reduced;
}

function useCountUp(target: number, ms = 600): number {
  const reduced = usePrefersReducedMotion();
  const [val, setVal] = useState(reduced ? target : 0);
  useEffect(() => {
    if (reduced) {
      setVal(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - (1 - p) ** 3;
      setVal(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms, reduced]);
  return val;
}

export function HeroStats({ stats }: { stats: OverviewStats | undefined }) {
  const projects = useCountUp(stats?.project_count ?? 0);
  const findings = useCountUp(stats?.finding_total ?? 0);
  const poc = useCountUp(Math.round((stats?.poc_rate ?? 0) * 100));
  const cwes = useCountUp(stats?.cwe_count ?? 0);

  const items = [
    { value: projects.toLocaleString(), label: "Projects scanned" },
    { value: findings.toLocaleString(), label: "Findings confirmed" },
    { value: `${poc}%`, label: "PoC-verified" },
    { value: cwes.toLocaleString(), label: "CWE categories" },
  ];

  return (
    <div className="mx-auto grid max-w-3xl grid-cols-2 gap-6 sm:grid-cols-4 sm:gap-4">
      {items.map((it) => (
        <div key={it.label} className="text-center">
          <p className="font-display text-3xl font-bold tabular-nums tracking-tight text-ink sm:text-4xl">
            {it.value}
          </p>
          <p className="mt-1.5 font-mono text-[11px] uppercase tracking-wider text-ink-tertiary">
            {it.label}
          </p>
        </div>
      ))}
    </div>
  );
}
