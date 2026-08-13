import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { OverviewStats, TrendDay } from "@openvuln/shared";
import { SEV_ORDER, severityLabel } from "../shared/lib/format";

const SEV = {
  high: "#F24F4F",
  medium: "#FF733C",
  low: "#F7C530",
  critical: "#C22828",
} as const;

type Pt = TrendDay;

function stackedAreas(data: Pt[], w = 560, h = 180) {
  const keys = ["critical", "high", "medium", "low"] as const;
  const max = Math.max(...data.map((d) =>  (d.critical??0)+d.high+d.medium+d.low ), 1);
  const x = (i: number) => (data.length <= 1 ? 0 : (i / (data.length - 1)) * w);
  const y = (v: number) => h - (v / max) * (h - 16);
  const acc = data.map(() => 0);
  return keys.map((k) => {
    const top = data.map((d, i) => {
      acc[i] += d[k];
      return [x(i), y(acc[i])] as const;
    });
    const base = data.map((d, i) => [x(i), y(acc[i] - d[k])] as const).reverse();
    const line = top
      .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
      .join("");
    const area = `${line}${base.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("")}Z`;
    return { key: k, area, line };
  });
}

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

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const PANEL = "rounded-lg border border-line bg-surface-raised p-4";
const EYEBROW = "font-mono text-[11px] uppercase tracking-wider text-ink-tertiary";

/** 首页第二页（浅色）：趋势图 / LIVE / 新增漏洞事件卡 / TOP CWE */
export function PlatformPulse({ stats }: { stats: OverviewStats | undefined }) {
  const reduced = usePrefersReducedMotion();
  const trend = stats?.trend ?? [];
  const layers = useMemo(() => (trend.length ? stackedAreas(trend) : []), [trend]);
  const pathRefs = useRef<(SVGPathElement | null)[]>([]);

  useEffect(() => {
    if (reduced) return;
    for (const el of pathRefs.current) {
      if (!el) continue;
      const len = el.getTotalLength();
      el.style.strokeDasharray = `${len}`;
      el.style.strokeDashoffset = `${len}`;
      el.getBoundingClientRect();
      el.style.transition = "stroke-dashoffset 900ms ease-out";
      el.style.strokeDashoffset = "0";
    }
  }, [layers, reduced]);

  const sevTotals = stats?.severity_counts ?? { critical: 0, high: 0, medium: 0, low: 0 };
  const live = stats?.live;
  const scanningCount = live?.scanning.length ?? 0;
  const queuedCount = live?.queued_count ?? 0;
  const cweTop = stats?.cwe_top ?? [];
  const cweMax = Math.max(1, ...cweTop.map((c) => c.count));
  const hasFindings =
    (stats?.finding_total ?? 0) > 0 || trend.some((d) =>  (d.critical??0)+d.high+d.medium+d.low  > 0);

  const xTicks = useMemo(() => {
    if (trend.length < 2) return [];
    const idxs = [0, 7, 14, 21, 29].filter((i) => i < trend.length);
    return idxs.map((i) => ({
      i,
      label: trend[i].date.slice(5),
      x: (i / (trend.length - 1)) * 560,
    }));
  }, [trend]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <p className={`mb-4 ${EYEBROW}`}>
        Platform Pulse
        <span className="mx-2 text-line">·</span>
        <span className="inline-flex items-center gap-1.5 text-success-ink">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
          </span>
          Live
        </span>
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Findings 趋势 */}
        <div className={`${PANEL} lg:col-span-7`}>
          <div className="flex items-baseline justify-between gap-2">
            <p className={EYEBROW}>Findings · last 30 days</p>
            <p className="font-display text-sm font-semibold text-ink">
              {(stats?.finding_total ?? 0).toLocaleString()}
            </p>
          </div>
          <div className="relative mt-3">
            {!hasFindings && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <span className="text-sm text-ink-tertiary">Awaiting first scans</span>
              </div>
            )}
            <svg
              viewBox="0 0 560 180"
              className="h-auto w-full"
              role="img"
              aria-label="Stacked area chart of findings by severity over the last 30 days"
            >
              {[0.25, 0.5, 0.75].map((g) => (
                <line
                  key={g}
                  x1={0}
                  x2={560}
                  y1={16 + (180 - 16) * (1 - g)}
                  y2={16 + (180 - 16) * (1 - g)}
                  stroke="#E7E8EB"
                  strokeWidth={1}
                />
              ))}
              {[...layers].reverse().map((layer) => (
                <path
                  key={`a-${layer.key}`}
                  d={layer.area}
                  fill={SEV[layer.key]}
                  fillOpacity={reduced ? 0.25 : 0}
                  style={
                    reduced
                      ? undefined
                      : { animation: "pulse-fade-in 400ms ease-out forwards", animationDelay: "200ms" }
                  }
                />
              ))}
              {layers.map((layer, idx) => (
                <path
                  key={`l-${layer.key}`}
                  ref={(el) => {
                    pathRefs.current[idx] = el;
                  }}
                  d={layer.line}
                  fill="none"
                  stroke={SEV[layer.key]}
                  strokeWidth={1.5}
                />
              ))}
              {xTicks.map((t) => (
                <text
                  key={t.i}
                  x={t.x}
                  y={176}
                  textAnchor={t.i === 0 ? "start" : t.i >= 28 ? "end" : "middle"}
                  className="fill-ink-tertiary"
                  style={{ fontSize: 10, fontFamily: "ui-monospace, monospace" }}
                >
                  {t.label}
                </text>
              ))}
            </svg>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px] text-ink-secondary">
            {SEV_ORDER.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: SEV[s] }}
                />
                {severityLabel(s)} {sevTotals[s]}
              </span>
            ))}
          </div>
        </div>

        {/* LIVE NOW */}
        <div className={`${PANEL} lg:col-span-5`}>
          <p className={EYEBROW}>Live now</p>
          <p className="mt-2 flex items-center gap-2 text-sm text-ink">
            <span className="relative flex h-2 w-2">
              {(scanningCount > 0 || queuedCount > 0) && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-50 motion-reduce:hidden" />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  scanningCount > 0 ? "bg-success" : "bg-ink-tertiary"
                }`}
              />
            </span>
            <span className="font-mono text-[13px]">
              {scanningCount > 0 || queuedCount > 0 ? (
                <>
                  {scanningCount} scanning · {queuedCount} queued
                </>
              ) : (
                <span className="text-ink-tertiary">Idle · queue empty</span>
              )}
            </span>
          </p>
          <ul className="mt-3 space-y-2.5">
            {(live?.scanning ?? []).map((s) => (
              <li key={s.project_id} className="flex items-center gap-2 text-sm">
                <LiveDot />
                <Link
                  to={`/p/${s.full_name}`}
                  className="min-w-0 flex-1 truncate text-ink hover:text-accent-600"
                >
                  {s.full_name}
                </Link>
                <span className="shrink-0 font-mono text-[12px] text-ink-tertiary">
                  {formatElapsed(s.elapsed_sec)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* TOP CWE */}
        <div className={`${PANEL} lg:col-span-12`}>
          <p className={EYEBROW}>Top CWE</p>
          {cweTop.length === 0 ? (
            <p className="mt-3 text-sm text-ink-tertiary">No CWE data yet.</p>
          ) : (
            <ul className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
              {cweTop.map((c) => (
                <li key={c.cwe} className="flex items-center gap-2 text-sm">
                  <a
                    href={
                      c.cwe.startsWith("CWE-")
                        ? `https://cwe.mitre.org/data/definitions/${c.cwe.replace("CWE-", "")}.html`
                        : undefined
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="w-[4.5rem] shrink-0 font-mono text-[12px] text-accent-600 hover:underline"
                  >
                    {c.cwe}
                  </a>
                  <span className="w-16 shrink-0 truncate text-[12px] text-ink-secondary">
                    {c.name ?? "—"}
                  </span>
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                    <div
                      className="h-full rounded-full bg-accent-600"
                      style={{ width: `${(c.count / cweMax) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 text-right font-mono text-[12px] text-ink-secondary">
                    {c.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse-fade-in {
          from { fill-opacity: 0; }
          to { fill-opacity: 0.25; }
        }
        @keyframes live-ring {
          0% { transform: scale(0.6); opacity: 0.7; }
          100% { transform: scale(2.2); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function LiveDot() {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
      <span
        className="absolute h-2.5 w-2.5 rounded-full bg-success/40 motion-reduce:hidden"
        style={{ animation: "live-ring 1.6s ease-out infinite" }}
      />
      <span className="relative h-1.5 w-1.5 rounded-full bg-success" />
    </span>
  );
}
